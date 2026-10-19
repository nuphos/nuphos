//! The runtime console's page, its static assets, the provider sign-in it can drive, and
//! the tools status it shows. The API it talks to lives in `runtime_console`.

use super::acp_server::{runtime_job, runtime_login};
use super::runtime_console::{authorize_write, ctx, ApiError, ApiResult};
use super::runtime_credentials::random_hex;
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::{mpsc, watch};
use tracing::info;

const INDEX_HTML: &str = include_str!("console/index.html");
const CONSOLE_JS: &str = include_str!("console/console.js");
const CONSOLE_CSS: &str = include_str!("console/console.css");
const MAX_BUFFERED_FRAMES: usize = 32;
const TOOLS_TIMEOUT_MS: u64 = 60_000;
/// How often an idle event stream rechecks that its session has not expired.
const SESSION_RECHECK: std::time::Duration = std::time::Duration::from_secs(30);
/// Frame fields the page may see. Anything else a login command prints (a credential,
/// for a command run without `--install`) never leaves the process.
const FRAME_FIELDS: &[&str] = &[
    "type",
    "url",
    "verificationUri",
    "userCode",
    "reason",
    "message",
];

fn security_headers(response: &mut Response) {
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
}

/// `GET /`: always 200, so a health check that curls the base URL keeps working in every
/// console state. The status rows are rendered on the server for clients without script.
pub async fn index(acp_enabled: bool) -> Response {
    let html = INDEX_HTML.replace("{{status_rows}}", &crate::status_rows(acp_enabled));
    let mut response = Html(html).into_response();
    security_headers(&mut response);
    response
}

fn asset(body: &'static str, content_type: &'static str) -> Response {
    let mut response = ([(header::CONTENT_TYPE, content_type)], body).into_response();
    security_headers(&mut response);
    response
}

/// What an open sign-in event stream is bound to: it ends as soon as its session does.
struct StreamWatch {
    console: Arc<super::runtime_console::RuntimeConsole>,
    session: String,
    signin: watch::Receiver<u64>,
    sessions: watch::Receiver<u64>,
}

struct Signin {
    attempt: String,
    frames: Vec<Value>,
    result: Option<Value>,
}

/// The console's latest sign-in, if one has run since start. Starting another, here or
/// over `/acp`, stops it.
static SIGNIN: parking_lot::Mutex<Option<Signin>> = parking_lot::Mutex::new(None);
static SIGNIN_CHANGED: std::sync::OnceLock<watch::Sender<u64>> = std::sync::OnceLock::new();

fn signin_changed() -> &'static watch::Sender<u64> {
    SIGNIN_CHANGED.get_or_init(|| watch::channel(0).0)
}

fn bump() {
    signin_changed().send_modify(|n| *n += 1);
}

fn visible_frame(frame: &Value) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(object) = frame.as_object() {
        for field in FRAME_FIELDS {
            if let Some(value) = object.get(*field).filter(|v| v.is_string()) {
                out.insert((*field).to_string(), value.clone());
            }
        }
    }
    Value::Object(out)
}

fn record_frame(attempt: &str, notification: &str) {
    let Ok(message) = serde_json::from_str::<Value>(notification) else {
        return;
    };
    let frame = &message["params"]["frame"];
    let mut slot = SIGNIN.lock();
    if let Some(signin) = slot.as_mut().filter(|s| s.attempt == attempt) {
        if frame["type"] == runtime_login::EXITED_FRAME {
            signin.result = Some(json!({"ok": frame["exitCode"] == 0}));
        } else if signin.frames.len() < MAX_BUFFERED_FRAMES {
            signin.frames.push(visible_frame(frame));
        }
    }
    drop(slot);
    bump();
}

/// Whether `attempt` is the sign-in this console started. Sign-ins started over `/acp`
/// share the runtime, so an attempt id alone does not make one the console's to drive.
fn console_owns(attempt: &str) -> bool {
    SIGNIN.lock().as_ref().is_some_and(|s| s.attempt == attempt)
}

async fn signin_start(State(state): State<Arc<crate::AppState>>, headers: HeaderMap) -> ApiResult {
    let ctx = ctx(&state)?;
    authorize_write(&ctx, &headers)?;
    let Some(command) = state.acp.as_ref().and_then(|c| c.login_command.clone()) else {
        return Err(ApiError(StatusCode::BAD_REQUEST, "signin_unsupported"));
    };
    let attempt = random_hex(16);
    *SIGNIN.lock() = Some(Signin {
        attempt: attempt.clone(),
        frames: Vec::new(),
        result: None,
    });
    bump();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let relay_attempt = attempt.clone();
    tokio::spawn(async move {
        while let Some(notification) = out_rx.recv().await {
            record_frame(&relay_attempt, &notification);
        }
    });
    runtime_login::start(
        &command,
        &attempt,
        &format!("console:{attempt}"),
        out_tx,
        state.acp_runtime_suspend.clone(),
    )
    .map_err(|_| {
        if let Some(signin) = SIGNIN.lock().as_mut().filter(|s| s.attempt == attempt) {
            signin.result = Some(json!({"ok": false}));
        }
        bump();
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, "signin_failed")
    })?;
    info!("runtime console: provider sign-in started");
    Ok(Json(json!({"attemptId": attempt})).into_response())
}

#[derive(Deserialize)]
struct AttemptQuery {
    #[serde(rename = "attemptId")]
    attempt_id: String,
}

async fn signin_events(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    Query(query): Query<AttemptQuery>,
) -> ApiResult {
    let ctx = ctx(&state)?;
    let Some(session) = ctx.console.session(&headers) else {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "login_required"));
    };
    if !console_owns(&query.attempt_id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "not_found"));
    }
    let watch = StreamWatch {
        sessions: ctx.console.sessions_ended(),
        console: ctx.console,
        session: session.key,
        signin: signin_changed().subscribe(),
    };
    let stream = futures_util::stream::unfold(
        (query.attempt_id, 0usize, false, watch),
        |(attempt, mut sent, finished, mut watch)| async move {
            if finished {
                return None;
            }
            loop {
                if !watch.console.session_alive(&watch.session) {
                    return None;
                }
                let next = {
                    let slot = SIGNIN.lock();
                    let signin = slot.as_ref().filter(|s| s.attempt == attempt)?;
                    if let Some(frame) = signin.frames.get(sent) {
                        Some((
                            Event::default().event("frame").data(frame.to_string()),
                            false,
                        ))
                    } else {
                        signin.result.as_ref().map(|result| {
                            (
                                Event::default().event("result").data(result.to_string()),
                                true,
                            )
                        })
                    }
                };
                if let Some((event, done)) = next {
                    sent += 1;
                    return Some((
                        Ok::<_, std::convert::Infallible>(event),
                        (attempt, sent, done, watch),
                    ));
                }
                tokio::select! {
                    changed = watch.signin.changed() => if changed.is_err() { return None },
                    changed = watch.sessions.changed() => if changed.is_err() { return None },
                    () = tokio::time::sleep(SESSION_RECHECK) => {}
                }
            }
        },
    );
    let mut response = Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response();
    security_headers(&mut response);
    Ok(response)
}

#[derive(Deserialize)]
struct InputRequest {
    #[serde(rename = "attemptId")]
    attempt_id: String,
    text: String,
}

async fn signin_input(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let ctx = ctx(&state)?;
    authorize_write(&ctx, &headers)?;
    let request: InputRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid_request"))?;
    if !console_owns(&request.attempt_id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "not_running"));
    }
    runtime_login::send_input(&request.attempt_id, request.text.trim()).map_err(|(code, _)| {
        match code {
            runtime_login::LOGIN_NOT_RUNNING => ApiError(StatusCode::NOT_FOUND, "not_running"),
            _ => ApiError(StatusCode::BAD_REQUEST, "invalid_input"),
        }
    })?;
    Ok(Json(json!({"delivered": true})).into_response())
}

#[derive(Deserialize)]
struct CancelRequest {
    #[serde(rename = "attemptId")]
    attempt_id: String,
}

async fn signin_cancel(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let ctx = ctx(&state)?;
    authorize_write(&ctx, &headers)?;
    let request: CancelRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid_request"))?;
    let cancelled =
        console_owns(&request.attempt_id) && runtime_login::cancel(Some(&request.attempt_id));
    Ok(Json(json!({"cancelled": cancelled})).into_response())
}

fn tools_job() -> String {
    std::env::var("OPENAB_RUNTIME_TOOLS_JOB")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "tools".into())
}

async fn tools(State(state): State<Arc<crate::AppState>>, headers: HeaderMap) -> ApiResult {
    let ctx = ctx(&state)?;
    if ctx.console.session(&headers).is_none() {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "login_required"));
    }
    let Some(jobs) = state.acp.as_ref().map(|c| c.runtime_jobs.clone()) else {
        return Err(ApiError(StatusCode::NOT_FOUND, "tools_unsupported"));
    };
    let job = tools_job();
    if !jobs.names().contains(&job.as_str()) {
        return Err(ApiError(StatusCode::NOT_FOUND, "tools_unsupported"));
    }
    let job_id = random_hex(16);
    let request = runtime_job::parse_request(
        Some(&json!({"jobId": job_id, "job": job, "timeoutMs": TOOLS_TIMEOUT_MS})),
        &jobs,
    )
    .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "tools_failed"))?;
    let result = runtime_job::run(&jobs, request, &format!("console:{job_id}"))
        .await
        .map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "tools_failed"))?;
    if result["exitCode"] != 0 {
        return Err(ApiError(StatusCode::BAD_GATEWAY, "tools_failed"));
    }
    let parsed: Value = result["stdout"]
        .as_str()
        .and_then(|out| serde_json::from_str(out).ok())
        .ok_or(ApiError(StatusCode::BAD_GATEWAY, "tools_failed"))?;
    Ok(Json(parsed).into_response())
}

pub fn routes() -> Router<Arc<crate::AppState>> {
    Router::new()
        .route(
            "/_openab/console/assets/console.js",
            get(|| async { asset(CONSOLE_JS, "text/javascript; charset=utf-8") }),
        )
        .route(
            "/_openab/console/assets/console.css",
            get(|| async { asset(CONSOLE_CSS, "text/css; charset=utf-8") }),
        )
        .route("/_openab/console/signin/start", post(signin_start))
        .route("/_openab/console/signin/events", get(signin_events))
        .route("/_openab/console/signin/input", post(signin_input))
        .route("/_openab/console/signin/cancel", post(signin_cancel))
        .route("/_openab/console/tools", get(tools))
        .layer(axum::extract::DefaultBodyLimit::max(16 * 1024))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn request(
        app: &Router,
        method: &str,
        uri: &str,
        cookie: Option<&str>,
        csrf: Option<&str>,
        body: Value,
    ) -> (StatusCode, HeaderMap, String) {
        use tower::ServiceExt;
        let mut builder = axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .header("host", "agent.test")
            .header("origin", "http://agent.test")
            .header("content-type", "application/json");
        if let Some(cookie) = cookie {
            builder = builder.header("cookie", cookie);
        }
        if let Some(csrf) = csrf {
            builder = builder.header("x-csrf-token", csrf);
        }
        let response = app
            .clone()
            .oneshot(
                builder
                    .body(axum::body::Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            axum::body::to_bytes(response.into_body(), 1 << 20),
        )
        .await
        .expect("response body ends")
        .unwrap();
        (
            status,
            headers,
            String::from_utf8_lossy(&bytes).into_owned(),
        )
    }

    #[tokio::test]
    async fn a_console_signin_streams_display_frames_and_its_result() {
        use crate::adapters::acp_server::{AcpConfig, LoginCommand, RuntimeJobs};
        use crate::adapters::runtime_console::RuntimeConsole;
        use crate::adapters::runtime_credentials::{temp_dir, CredentialStore};

        let _guard = runtime_login::TEST_GUARD.lock().await;
        let (tx, _) = tokio::sync::broadcast::channel(4);
        let mut state = crate::AppState::test_default(tx);
        state.acp = Some(AcpConfig {
            auth_key: None,
            control_key: None,
            allowed_origins: vec![],
            login_command: Some(LoginCommand {
                program: "printf".into(),
                args: vec![r#"{"type":"authenticated","authJson":"secret-credential"}\n"#.into()],
            }),
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: Some(Arc::new(CredentialStore::in_memory(None, None))),
            console: Some(Arc::new(
                RuntimeConsole::open(
                    temp_dir("signin"),
                    None,
                    None,
                    std::time::Duration::from_secs(60),
                )
                .unwrap(),
            )),
        });
        let app = super::super::runtime_console::routes()
            .merge(routes())
            .with_state(Arc::new(state));

        let (status, headers, _) = request(
            &app,
            "POST",
            "/_openab/console/setup",
            None,
            None,
            json!({"password": "correct-horse-battery"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let cookie = headers[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let (_, _, body) = request(
            &app,
            "GET",
            "/_openab/console/state",
            Some(&cookie),
            None,
            Value::Null,
        )
        .await;
        let csrf = serde_json::from_str::<Value>(&body).unwrap()["csrfToken"]
            .as_str()
            .unwrap()
            .to_string();

        let (status, _, body) = request(
            &app,
            "POST",
            "/_openab/console/signin/start",
            Some(&cookie),
            Some(&csrf),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let attempt = serde_json::from_str::<Value>(&body).unwrap()["attemptId"]
            .as_str()
            .unwrap()
            .to_string();
        let (status, _, events) = request(
            &app,
            "GET",
            &format!("/_openab/console/signin/events?attemptId={attempt}"),
            Some(&cookie),
            None,
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(events.contains("event: frame"), "{events}");
        assert!(events.contains(r#"{"type":"authenticated"}"#), "{events}");
        assert!(
            !events.contains("secret-credential"),
            "credentials never reach the page"
        );
        assert!(events.contains("event: result"), "{events}");
        assert!(events.contains(r#""ok":true"#), "{events}");

        let (status, _, _) = request(
            &app,
            "GET",
            &format!("/_openab/console/signin/events?attemptId={attempt}"),
            None,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let (acp_tx, _acp_rx) = mpsc::unbounded_channel();
        runtime_login::start(
            &LoginCommand {
                program: "cat".into(),
                args: vec![],
            },
            "acp-attempt",
            "acp_conn_other",
            acp_tx,
            None,
        )
        .unwrap();
        for path in ["input", "cancel"] {
            let (status, _, body) = request(
                &app,
                "POST",
                &format!("/_openab/console/signin/{path}"),
                Some(&cookie),
                Some(&csrf),
                json!({"attemptId": "acp-attempt", "text": "code#state"}),
            )
            .await;
            match path {
                "input" => assert_eq!(status, StatusCode::NOT_FOUND, "{body}"),
                _ => assert!(body.contains(r#""cancelled":false"#), "{body}"),
            }
        }
        assert!(
            runtime_login::cancel(Some("acp-attempt")),
            "the /acp sign-in is untouched"
        );
    }

    #[tokio::test]
    async fn a_signin_stream_ends_when_its_session_does() {
        use crate::adapters::acp_server::{AcpConfig, LoginCommand, RuntimeJobs};
        use crate::adapters::runtime_console::RuntimeConsole;
        use crate::adapters::runtime_credentials::{temp_dir, CredentialStore};
        use futures_util::StreamExt;
        use tower::ServiceExt;

        let _guard = runtime_login::TEST_GUARD.lock().await;
        let (tx, _) = tokio::sync::broadcast::channel(4);
        let mut state = crate::AppState::test_default(tx);
        state.acp = Some(AcpConfig {
            auth_key: None,
            control_key: None,
            allowed_origins: vec![],
            login_command: Some(LoginCommand {
                program: "sh".into(),
                args: vec![
                    "-c".into(),
                    r#"printf '{"type":"device","userCode":"AB-CD","verificationUri":"https://example.test"}\n'; read line; printf '{"type":"authenticated"}\n'"#.into(),
                ],
            }),
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: Some(Arc::new(CredentialStore::in_memory(None, None))),
            console: Some(Arc::new(
                RuntimeConsole::open(
                    temp_dir("signin-session"),
                    None,
                    None,
                    std::time::Duration::from_secs(60),
                )
                .unwrap(),
            )),
        });
        let app = super::super::runtime_console::routes()
            .merge(routes())
            .with_state(Arc::new(state));

        let (_, headers, _) = request(
            &app,
            "POST",
            "/_openab/console/setup",
            None,
            None,
            json!({"password": "correct-horse-battery"}),
        )
        .await;
        let cookie = headers[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let (_, _, body) = request(
            &app,
            "GET",
            "/_openab/console/state",
            Some(&cookie),
            None,
            Value::Null,
        )
        .await;
        let csrf = serde_json::from_str::<Value>(&body).unwrap()["csrfToken"]
            .as_str()
            .unwrap()
            .to_string();
        let (_, _, body) = request(
            &app,
            "POST",
            "/_openab/console/signin/start",
            Some(&cookie),
            Some(&csrf),
            Value::Null,
        )
        .await;
        let attempt = serde_json::from_str::<Value>(&body).unwrap()["attemptId"]
            .as_str()
            .unwrap()
            .to_string();

        let events = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!(
                        "/_openab/console/signin/events?attemptId={attempt}"
                    ))
                    .header("host", "agent.test")
                    .header("cookie", &cookie)
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let mut stream = events.into_body().into_data_stream();
        let first = tokio::time::timeout(std::time::Duration::from_secs(30), stream.next())
            .await
            .expect("the device frame arrives")
            .unwrap()
            .unwrap();
        assert!(String::from_utf8_lossy(&first).contains("AB-CD"));

        let (status, _, _) = request(
            &app,
            "POST",
            "/_openab/console/logout",
            Some(&cookie),
            Some(&csrf),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let rest = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            let mut rest = String::new();
            while let Some(chunk) = stream.next().await {
                rest.push_str(&String::from_utf8_lossy(&chunk.unwrap()));
            }
            rest
        })
        .await
        .expect("the stream ends with its session");
        assert!(
            !rest.contains("event:"),
            "nothing more after logout: {rest}"
        );

        assert!(runtime_login::cancel(Some(&attempt)));
    }

    #[test]
    fn frames_keep_only_display_fields() {
        let frame = json!({"type": "authenticated", "authJson": "{\"secret\":1}", "url": 3});
        assert_eq!(visible_frame(&frame), json!({"type": "authenticated"}));
        let device = json!({"type": "device", "verificationUri": "https://x", "userCode": "AB-CD"});
        assert_eq!(visible_frame(&device), device);
    }

    #[tokio::test]
    async fn the_page_is_served_with_status_rows_and_locked_down_headers() {
        let response = index(true).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::X_FRAME_OPTIONS], "DENY");
        let csp = response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains("default-src 'self'"));
        let body = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("<dt>ACP</dt><dd>enabled</dd>"));
        assert!(!html.contains("{{status_rows}}"));
        assert!(!html.contains("<script>"), "no inline script under the CSP");
        assert!(!html.contains("style="), "no inline style under the CSP");
    }
}
