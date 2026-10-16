//! The runtime console backend (`OPENAB_RUNTIME_CONSOLE`): first-run setup, a password
//! login, and the actions an owner takes on their runtime — minting pairing codes,
//! listing and revoking bindings, changing the password and the public URL.
//!
//! State machine: with no `console.json`, no legacy password file and no
//! `OPENAB_ACP_AUTH_KEY`, the runtime is uninitialized. Setup is open for
//! `OPENAB_RUNTIME_SETUP_WINDOW_SECS` after process start, then locked until a restart.

use super::runtime_credentials::{
    random_hex, read_legacy_key, sha256_hex, write_private_atomic, write_private_temp, Binding,
    CredentialStore,
};
use super::runtime_pairing::{client_ip, MintError, RateLimiter};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path as UrlPath, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine as _;
use chrono::{DateTime, Utc};
use parking_lot::{Mutex, RwLock};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{error, info, warn};

const CONSOLE_FILE: &str = "console.json";
const DEFAULT_SETUP_WINDOW_SECS: u64 = 30 * 60;
pub const MIN_PASSWORD_CHARS: usize = 12;
const MAX_PASSWORD_BYTES: usize = 1024;
const SESSION_IDLE: Duration = Duration::from_secs(12 * 60 * 60);
const SESSION_MAX: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const MAX_SESSIONS: usize = 64;
const MAX_BODY_BYTES: usize = 16 * 1024;
const SECURE_COOKIE: &str = "__Host-nuphos_console";
const PLAIN_COOKIE: &str = "nuphos_console";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleFile {
    version: u32,
    password_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    initialized_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password_changed_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    public_url: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InitializedBy {
    Console,
    LegacyPassword,
    Deployment,
}

#[derive(Clone, Debug)]
struct Config {
    file: ConsoleFile,
    by: InitializedBy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Setup,
    Locked,
    Login,
}

struct Session {
    csrf: String,
    created: Instant,
    last_seen: Instant,
}

pub(crate) struct SessionInfo {
    pub key: String,
    pub csrf: String,
}

pub struct RuntimeConsole {
    dir: PathBuf,
    started: Instant,
    setup_window: Duration,
    config: RwLock<Option<Config>>,
    sessions: Mutex<HashMap<String, Session>>,
    sessions_ended: tokio::sync::watch::Sender<u64>,
    logins: RateLimiter,
    setup: tokio::sync::Mutex<()>,
}

fn hash_password(password: &str) -> anyhow::Result<String> {
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    let salt = SaltString::encode_b64(&salt).map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("{e}"))?
        .to_string())
}

fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

async fn hash_blocking(password: String) -> anyhow::Result<String> {
    tokio::task::spawn_blocking(move || hash_password(&password)).await?
}

async fn verify_blocking(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || verify_password(&password, &hash))
        .await
        .unwrap_or(false)
}

fn generated_password() -> String {
    let mut raw = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw)
}

fn valid_new_password(password: &str) -> bool {
    password.chars().count() >= MIN_PASSWORD_CHARS && password.len() <= MAX_PASSWORD_BYTES
}

/// `ws(s)://host[:port]/acp` from what an owner typed: http(s) or ws(s), path optional.
pub fn normalize_public_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let (scheme, rest) = raw.split_once("://")?;
    let scheme = match scheme.to_ascii_lowercase().as_str() {
        "https" | "wss" => "wss",
        "http" | "ws" => "ws",
        _ => return None,
    };
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let path = path.split(['?', '#']).next().unwrap_or("");
    if host.is_empty()
        || host.contains('@')
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-:[]_".contains(&b))
    {
        return None;
    }
    let path = path.trim_end_matches('/');
    let path = if path.is_empty() {
        "/acp".to_string()
    } else {
        format!("/{path}")
    };
    if path.len() > 256
        || !path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/-._~".contains(&b))
    {
        return None;
    }
    Some(format!("{scheme}://{}{path}", host.to_ascii_lowercase()))
}

fn forwarded_https(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("https"))
}

fn request_host(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
}

fn origin_host(value: &str) -> Option<String> {
    let (_, rest) = value.split_once("://")?;
    let host = rest.split(['/', '?', '#']).next()?;
    Some(host.to_ascii_lowercase())
}

/// Console writes must come from a page on this same host. `SameSite=Strict` already keeps
/// the cookie off cross-site requests; this also refuses a request that carries no origin.
pub(crate) fn same_origin(headers: &HeaderMap) -> bool {
    let Some(host) = request_host(headers) else {
        return false;
    };
    let source = headers
        .get(header::ORIGIN)
        .or_else(|| headers.get(header::REFERER))
        .and_then(|v| v.to_str().ok())
        .and_then(origin_host);
    source.is_some_and(|source| source == host)
}

/// Every console session token the request carries, under either cookie name. A
/// browser that has used the console over both http and https can hold one of each.
fn session_tokens(headers: &HeaderMap) -> Vec<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .filter(|(key, value)| (*key == SECURE_COOKIE || *key == PLAIN_COOKIE) && !value.is_empty())
        .map(|(_, value)| value)
        .collect()
}

fn session_cookie(headers: &HeaderMap, token: &str, max_age: u64) -> HeaderValue {
    let secure = forwarded_https(headers);
    let name = if secure { SECURE_COOKIE } else { PLAIN_COOKIE };
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{name}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"
    ))
    .expect("cookie is ASCII")
}

impl RuntimeConsole {
    /// Load the console state from `dir`, migrating a legacy password file or adopting the
    /// deployment key when there is no `console.json` yet.
    pub fn open(
        dir: PathBuf,
        legacy_key_file: Option<&Path>,
        env_password: Option<&str>,
        setup_window: Duration,
    ) -> anyhow::Result<Self> {
        let path = dir.join(CONSOLE_FILE);
        let config = match std::fs::read(&path) {
            Ok(bytes) => Some(Config {
                file: serde_json::from_slice(&bytes)?,
                by: InitializedBy::Console,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if let Some((password, modified)) = legacy_key_file.and_then(read_legacy_key) {
                    let file = ConsoleFile {
                        version: 1,
                        password_hash: hash_password(&password)?,
                        initialized_at: Some(modified),
                        password_changed_at: None,
                        public_url: None,
                    };
                    write_private_atomic(&path, &serde_json::to_vec_pretty(&file)?)?;
                    info!(
                        "runtime console: the legacy runtime password is now the console password"
                    );
                    Some(Config {
                        file,
                        by: InitializedBy::LegacyPassword,
                    })
                } else if let Some(password) = env_password.filter(|p| !p.is_empty()) {
                    Some(Config {
                        file: ConsoleFile {
                            version: 1,
                            password_hash: hash_password(password)?,
                            initialized_at: None,
                            password_changed_at: None,
                            public_url: None,
                        },
                        by: InitializedBy::Deployment,
                    })
                } else {
                    None
                }
            }
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            dir,
            started: Instant::now(),
            setup_window,
            config: RwLock::new(config),
            sessions: Mutex::new(HashMap::new()),
            sessions_ended: tokio::sync::watch::channel(0).0,
            logins: RateLimiter::new(5, 30, Duration::from_secs(60)),
            setup: tokio::sync::Mutex::new(()),
        })
    }

    pub fn phase(&self) -> Phase {
        if self.config.read().is_some() {
            Phase::Login
        } else if self.started.elapsed() < self.setup_window {
            Phase::Setup
        } else {
            Phase::Locked
        }
    }

    fn setup_window_ends_at(&self) -> DateTime<Utc> {
        let remaining = self.setup_window.saturating_sub(self.started.elapsed());
        Utc::now() + chrono::Duration::from_std(remaining).unwrap_or_default()
    }

    fn write(&self, file: &ConsoleFile) -> anyhow::Result<()> {
        write_private_atomic(
            &self.dir.join(CONSOLE_FILE),
            &serde_json::to_vec_pretty(file)?,
        )?;
        Ok(())
    }

    /// First POST wins: the file is linked into place only if it does not exist yet.
    async fn initialize(&self, password: &str) -> Result<DateTime<Utc>, StatusCode> {
        let _guard = self.setup.lock().await;
        match self.phase() {
            Phase::Setup => {}
            Phase::Locked => return Err(StatusCode::FORBIDDEN),
            Phase::Login => return Err(StatusCode::CONFLICT),
        }
        let now = Utc::now();
        let file = ConsoleFile {
            version: 1,
            password_hash: hash_blocking(password.to_string())
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            initialized_at: Some(now),
            password_changed_at: None,
            public_url: None,
        };
        let path = self.dir.join(CONSOLE_FILE);
        let bytes =
            serde_json::to_vec_pretty(&file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let tmp = write_private_temp(&path, &bytes).map_err(|e| {
            error!(error = %e, "runtime console: could not write console.json");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        let linked = std::fs::hard_link(&tmp, &path);
        let _ = std::fs::remove_file(&tmp);
        match linked {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(StatusCode::CONFLICT)
            }
            Err(e) => {
                error!(error = %e, "runtime console: could not write console.json");
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
        *self.config.write() = Some(Config {
            file,
            by: InitializedBy::Console,
        });
        Ok(now)
    }

    fn create_session(&self) -> (String, String) {
        let token = random_hex(32);
        let csrf = random_hex(32);
        let now = Instant::now();
        let mut sessions = self.sessions.lock();
        sessions.retain(|_, s| {
            s.last_seen.elapsed() < SESSION_IDLE && s.created.elapsed() < SESSION_MAX
        });
        if sessions.len() >= MAX_SESSIONS {
            if let Some(oldest) = sessions
                .iter()
                .min_by_key(|(_, s)| s.last_seen)
                .map(|(k, _)| k.clone())
            {
                sessions.remove(&oldest);
            }
        }
        sessions.insert(
            sha256_hex(token.as_bytes()),
            Session {
                csrf: csrf.clone(),
                created: now,
                last_seen: now,
            },
        );
        (token, csrf)
    }

    pub(crate) fn session(&self, headers: &HeaderMap) -> Option<SessionInfo> {
        let mut sessions = self.sessions.lock();
        for token in session_tokens(headers) {
            let key = sha256_hex(token.as_bytes());
            let Some(session) = sessions.get_mut(&key) else {
                continue;
            };
            if session.last_seen.elapsed() >= SESSION_IDLE
                || session.created.elapsed() >= SESSION_MAX
            {
                sessions.remove(&key);
                continue;
            }
            session.last_seen = Instant::now();
            return Some(SessionInfo {
                key,
                csrf: session.csrf.clone(),
            });
        }
        None
    }

    fn end_other_sessions(&self, keep: &str) {
        self.sessions.lock().retain(|key, _| key == keep);
        self.sessions_ended.send_modify(|n| *n += 1);
    }

    /// End every session the request presents, not only the one that authorized it.
    fn end_presented_sessions(&self, headers: &HeaderMap) {
        let mut sessions = self.sessions.lock();
        for token in session_tokens(headers) {
            sessions.remove(&sha256_hex(token.as_bytes()));
        }
        drop(sessions);
        self.sessions_ended.send_modify(|n| *n += 1);
    }

    /// Whether the session behind `key` still exists and has not expired. Unlike
    /// `session`, it does not count as activity.
    pub(crate) fn session_alive(&self, key: &str) -> bool {
        self.sessions.lock().get(key).is_some_and(|s| {
            s.last_seen.elapsed() < SESSION_IDLE && s.created.elapsed() < SESSION_MAX
        })
    }

    /// Notified whenever sessions are ended, so long-lived responses can stop.
    pub(crate) fn sessions_ended(&self) -> tokio::sync::watch::Receiver<u64> {
        self.sessions_ended.subscribe()
    }

    fn public_url(&self, headers: &HeaderMap) -> (Option<String>, &'static str) {
        if let Some(url) = self
            .config
            .read()
            .as_ref()
            .and_then(|c| c.file.public_url.clone())
        {
            return (Some(url), "console");
        }
        if let Some(url) = std::env::var("OPENAB_RUNTIME_PUBLIC_URL")
            .ok()
            .as_deref()
            .and_then(normalize_public_url)
        {
            return (Some(url), "environment");
        }
        let scheme = if forwarded_https(headers) {
            "wss"
        } else {
            "ws"
        };
        (
            request_host(headers).map(|host| format!("{scheme}://{host}/acp")),
            "request",
        )
    }
}

fn console_setup_window() -> Duration {
    Duration::from_secs(
        std::env::var("OPENAB_RUNTIME_SETUP_WINDOW_SECS")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(DEFAULT_SETUP_WINDOW_SECS),
    )
}

/// The console for this process, when `OPENAB_RUNTIME_CONSOLE` is on. A `console.json`
/// that cannot be read disables it, so a damaged file never reopens setup.
pub fn from_env(env_password: Option<&String>) -> Option<Arc<RuntimeConsole>> {
    if !super::runtime_credentials::console_enabled() {
        return None;
    }
    let dir = super::runtime_credentials::state_dir();
    let legacy = super::runtime_credentials::legacy_key_file(&dir);
    match RuntimeConsole::open(
        dir.clone(),
        Some(&legacy),
        env_password.map(String::as_str),
        console_setup_window(),
    ) {
        Ok(console) => Some(Arc::new(console)),
        Err(e) => {
            error!(dir = %dir.display(), error = %e, "runtime console unavailable");
            None
        }
    }
}

fn no_store(mut response: Response) -> Response {
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
    response
}

pub(crate) struct ApiError(pub StatusCode, pub &'static str);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

pub(crate) type ApiResult = Result<Response, ApiError>;

pub(crate) struct Ctx {
    pub console: Arc<RuntimeConsole>,
    pub store: Arc<CredentialStore>,
}

pub(crate) fn ctx(state: &crate::AppState) -> Result<Ctx, ApiError> {
    let acp = state.acp.as_ref();
    match (
        acp.and_then(|c| c.console.clone()),
        acp.and_then(|c| c.credentials.clone()),
    ) {
        (Some(console), Some(store)) => Ok(Ctx { console, store }),
        _ => Err(ApiError(StatusCode::NOT_FOUND, "not_found")),
    }
}

/// A signed-in session making a same-origin write with its CSRF token.
pub(crate) fn authorize_write(ctx: &Ctx, headers: &HeaderMap) -> Result<SessionInfo, ApiError> {
    if !same_origin(headers) {
        return Err(ApiError(StatusCode::FORBIDDEN, "cross_origin"));
    }
    let Some(session) = ctx.console.session(headers) else {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "login_required"));
    };
    let sent = headers
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !bool::from(subtle::ConstantTimeEq::ct_eq(
        sent.as_bytes(),
        session.csrf.as_bytes(),
    )) {
        return Err(ApiError(StatusCode::FORBIDDEN, "csrf"));
    }
    Ok(session)
}

fn parse<T: serde::de::DeserializeOwned>(body: &Bytes) -> Result<T, ApiError> {
    serde_json::from_slice(body).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid_request"))
}

fn binding_view(binding: &Binding) -> Value {
    json!({
        "id": binding.id,
        "label": binding.label,
        "source": binding.source,
        "state": binding.state,
        "createdAt": binding.created_at,
        "activatedAt": binding.activated_at,
        "lastUsedAt": binding.last_used_at,
        "pendingUntil": binding.pending_until(),
        "client": binding.client,
    })
}

fn env_label(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

async fn state_handler(State(state): State<Arc<crate::AppState>>, headers: HeaderMap) -> ApiResult {
    let ctx = ctx(&state)?;
    let phase = ctx.console.phase();
    let mut body = json!({
        "phase": phase,
        "label": env_label("OPENAB_RUNTIME_LABEL"),
        "version": env_label("OPENAB_RUNTIME_VERSION"),
        "minPasswordLength": MIN_PASSWORD_CHARS,
    });
    if phase == Phase::Setup {
        body["setupWindowEndsAt"] = json!(ctx.console.setup_window_ends_at());
    }
    let Some(session) = ctx
        .console
        .session(&headers)
        .filter(|_| phase == Phase::Login)
    else {
        return Ok(Json(body).into_response());
    };
    let config = ctx.console.config.read().clone();
    let (public_url, public_url_source) = ctx.console.public_url(&headers);
    body["phase"] = json!("console");
    body["csrfToken"] = json!(session.csrf);
    body["initializedAt"] = json!(config.as_ref().and_then(|c| c.file.initialized_at));
    body["initializedBy"] = json!(config.as_ref().map(|c| c.by));
    body["passwordChangedAt"] = json!(config.as_ref().and_then(|c| c.file.password_changed_at));
    body["publicUrl"] = json!(public_url);
    body["publicUrlSource"] = json!(public_url_source);
    body["bindings"] = ctx.store.list().iter().map(binding_view).collect();
    body["deploymentKeys"] = json!({
        "transport": ctx.store.has_env_transport(),
        "control": ctx.store.has_env_control(),
    });
    body["pairing"] = json!({
        "activeCodes": ctx.store.pairing.active(),
        "deepLinks": std::env::var("OPENAB_RUNTIME_CONNECT_URL_TEMPLATE").is_ok_and(|t| !t.is_empty()),
    });
    body["provider"] = json!({
        "authenticated": super::acp_server::runtime_authenticated(&state),
        "signInSupported": state.acp.as_ref().is_some_and(|c| c.login_command.is_some()),
    });
    Ok(Json(body).into_response())
}

#[derive(Deserialize)]
struct SetupRequest {
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    generate: bool,
}

async fn setup_handler(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let ctx = ctx(&state)?;
    if !same_origin(&headers) {
        return Err(ApiError(StatusCode::FORBIDDEN, "cross_origin"));
    }
    let request: SetupRequest = parse(&body)?;
    let (password, generated) = match (request.generate, request.password) {
        (true, None) => (generated_password(), true),
        (false, Some(password)) if valid_new_password(&password) => (password, false),
        (false, Some(_)) => return Err(ApiError(StatusCode::BAD_REQUEST, "password_too_short")),
        _ => return Err(ApiError(StatusCode::BAD_REQUEST, "invalid_request")),
    };
    let initialized_at = match ctx.console.initialize(&password).await {
        Ok(at) => at,
        Err(StatusCode::CONFLICT) => {
            return Err(ApiError(StatusCode::CONFLICT, "already_initialized"))
        }
        Err(StatusCode::FORBIDDEN) => return Err(ApiError(StatusCode::FORBIDDEN, "setup_locked")),
        Err(status) => return Err(ApiError(status, "setup_failed")),
    };
    let at = initialized_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    if generated {
        info!("Runtime console password set at {at}: {password}");
    } else {
        info!("Runtime console password set at {at}");
    }
    let (token, _) = ctx.console.create_session();
    let mut response = Json(json!({
        "initializedAt": initialized_at,
        "password": generated.then_some(password),
    }))
    .into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        session_cookie(&headers, &token, SESSION_MAX.as_secs()),
    );
    Ok(response)
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

async fn login_handler(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let ctx = ctx(&state)?;
    if !same_origin(&headers) {
        return Err(ApiError(StatusCode::FORBIDDEN, "cross_origin"));
    }
    let ip = client_ip(&headers);
    if !ctx.console.logins.allow(&ip) {
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "rate_limited"));
    }
    let request: LoginRequest = parse(&body)?;
    let Some(hash) = ctx
        .console
        .config
        .read()
        .as_ref()
        .map(|c| c.file.password_hash.clone())
    else {
        return Err(ApiError(StatusCode::CONFLICT, "not_initialized"));
    };
    if request.password.len() > MAX_PASSWORD_BYTES || !verify_blocking(request.password, hash).await
    {
        warn!("runtime console: failed login");
        return Err(ApiError(StatusCode::UNAUTHORIZED, "wrong_password"));
    }
    let (token, _) = ctx.console.create_session();
    info!("runtime console: signed in");
    let mut response = Json(json!({"ok": true})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        session_cookie(&headers, &token, SESSION_MAX.as_secs()),
    );
    Ok(response)
}

async fn logout_handler(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
) -> ApiResult {
    let ctx = ctx(&state)?;
    authorize_write(&ctx, &headers)?;
    ctx.console.end_presented_sessions(&headers);
    let mut response = Json(json!({"ok": true})).into_response();
    for expired in [
        format!("{SECURE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure"),
        format!("{PLAIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"),
    ] {
        response.headers_mut().append(
            header::SET_COOKIE,
            HeaderValue::from_str(&expired).expect("cookie is ASCII"),
        );
    }
    Ok(response)
}

#[derive(Deserialize)]
struct PasswordRequest {
    current: String,
    next: String,
}

async fn password_handler(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let ctx = ctx(&state)?;
    let session = authorize_write(&ctx, &headers)?;
    let request: PasswordRequest = parse(&body)?;
    if !valid_new_password(&request.next) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "password_too_short"));
    }
    let ip = client_ip(&headers);
    if !ctx.console.logins.allow(&ip) {
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "rate_limited"));
    }
    let Some(config) = ctx.console.config.read().clone() else {
        return Err(ApiError(StatusCode::CONFLICT, "not_initialized"));
    };
    if request.current.len() > MAX_PASSWORD_BYTES
        || !verify_blocking(request.current, config.file.password_hash.clone()).await
    {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "wrong_password"));
    }
    let Ok(hash) = hash_blocking(request.next).await else {
        return Err(ApiError(StatusCode::INTERNAL_SERVER_ERROR, "hash_failed"));
    };
    let now = Utc::now();
    let mut file = config.file;
    file.password_hash = hash;
    file.password_changed_at = Some(now);
    file.initialized_at.get_or_insert(now);
    if let Err(e) = ctx.console.write(&file) {
        error!(error = %e, "runtime console: could not write console.json");
        return Err(ApiError(StatusCode::INTERNAL_SERVER_ERROR, "write_failed"));
    }
    *ctx.console.config.write() = Some(Config {
        file,
        by: config.by,
    });
    ctx.console.end_other_sessions(&session.key);
    info!(
        "Runtime console password changed at {}",
        now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    );
    Ok(Json(json!({"passwordChangedAt": now})).into_response())
}

#[derive(Deserialize)]
struct PublicUrlRequest {
    url: Option<String>,
}

async fn public_url_handler(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let ctx = ctx(&state)?;
    authorize_write(&ctx, &headers)?;
    let request: PublicUrlRequest = parse(&body)?;
    let url = match request
        .url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        None => None,
        Some(raw) => match normalize_public_url(raw) {
            Some(url) => Some(url),
            None => return Err(ApiError(StatusCode::BAD_REQUEST, "invalid_url")),
        },
    };
    let Some(config) = ctx.console.config.read().clone() else {
        return Err(ApiError(StatusCode::CONFLICT, "not_initialized"));
    };
    let mut file = config.file;
    file.public_url = url;
    if let Err(e) = ctx.console.write(&file) {
        error!(error = %e, "runtime console: could not write console.json");
        return Err(ApiError(StatusCode::INTERNAL_SERVER_ERROR, "write_failed"));
    }
    *ctx.console.config.write() = Some(Config {
        file,
        by: config.by,
    });
    let (public_url, source) = ctx.console.public_url(&headers);
    Ok(Json(json!({"publicUrl": public_url, "publicUrlSource": source})).into_response())
}

fn deep_link(template: &str, url: &str, code: &str, expires: DateTime<Utc>) -> String {
    template
        .replace("{url}", &urlencoding::encode(url))
        .replace("{code}", &urlencoding::encode(code))
        .replace("{exp}", &expires.timestamp().to_string())
}

async fn pairing_code_handler(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
) -> ApiResult {
    let ctx = ctx(&state)?;
    authorize_write(&ctx, &headers)?;
    let (code, expires) = match ctx.store.pairing.mint() {
        Ok(minted) => minted,
        Err(MintError::TooManyActive) => {
            return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "too_many_codes"))
        }
    };
    let (url, _) = ctx.console.public_url(&headers);
    let link = std::env::var("OPENAB_RUNTIME_CONNECT_URL_TEMPLATE")
        .ok()
        .filter(|t| !t.is_empty())
        .zip(url.as_deref())
        .map(|(template, url)| deep_link(&template, url, &code, expires));
    info!("runtime console: pairing code minted");
    Ok(Json(json!({
        "code": code,
        "expiresAt": expires,
        "url": url,
        "deepLink": link,
    }))
    .into_response())
}

async fn revoke_handler(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> ApiResult {
    let ctx = ctx(&state)?;
    authorize_write(&ctx, &headers)?;
    match ctx.store.revoke(&id) {
        Ok(true) => {}
        Ok(false) => return Err(ApiError(StatusCode::NOT_FOUND, "not_found")),
        Err(_) => return Err(ApiError(StatusCode::INTERNAL_SERVER_ERROR, "write_failed")),
    }
    Ok(Json(json!({"revoked": true})).into_response())
}

/// Console API routes. Every response is uncacheable and unframeable.
pub fn routes() -> Router<Arc<crate::AppState>> {
    Router::new()
        .route("/_openab/console/state", get(state_handler))
        .route("/_openab/console/setup", post(setup_handler))
        .route("/_openab/console/login", post(login_handler))
        .route("/_openab/console/logout", post(logout_handler))
        .route("/_openab/console/password", post(password_handler))
        .route("/_openab/console/public-url", post(public_url_handler))
        .route("/_openab/console/pairing-codes", post(pairing_code_handler))
        .route("/_openab/console/bindings/{id}", delete(revoke_handler))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(axum::middleware::map_response(|r: Response| async {
            no_store(r)
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::acp_server::{AcpConfig, RuntimeJobs};
    use crate::adapters::runtime_credentials::temp_dir;

    const HOST: &str = "runtime.example";

    fn new_console(dir: PathBuf, window: Duration) -> Arc<RuntimeConsole> {
        Arc::new(RuntimeConsole::open(dir, None, None, window).unwrap())
    }

    fn new_app(console: Arc<RuntimeConsole>, store: Arc<CredentialStore>) -> Router {
        let (tx, _) = tokio::sync::broadcast::channel(4);
        let mut state = crate::AppState::test_default(tx);
        state.acp = Some(AcpConfig {
            auth_key: None,
            control_key: None,
            allowed_origins: vec![],
            login_command: None,
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: Some(store),
            console: Some(console),
        });
        routes().with_state(Arc::new(state))
    }

    struct Client {
        app: Router,
        cookie: Option<String>,
        csrf: Option<String>,
        origin: Option<String>,
        https: bool,
    }

    struct Reply {
        status: StatusCode,
        headers: HeaderMap,
        body: Value,
    }

    impl Client {
        fn new(app: Router) -> Self {
            Self {
                app,
                cookie: None,
                csrf: None,
                origin: Some(format!("http://{HOST}")),
                https: false,
            }
        }

        async fn call(&mut self, method: &str, uri: &str, body: Value) -> Reply {
            use tower::ServiceExt;
            let mut request = axum::http::Request::builder()
                .method(method)
                .uri(uri)
                .header("host", HOST)
                .header("content-type", "application/json");
            if let Some(origin) = &self.origin {
                request = request.header("origin", origin);
            }
            if let Some(cookie) = &self.cookie {
                request = request.header("cookie", cookie);
            }
            if let Some(csrf) = &self.csrf {
                request = request.header("x-csrf-token", csrf);
            }
            if self.https {
                request = request.header("x-forwarded-proto", "https");
            }
            let response = self
                .app
                .clone()
                .oneshot(
                    request
                        .body(axum::body::Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            let status = response.status();
            let headers = response.headers().clone();
            if let Some(cookie) = headers.get(header::SET_COOKIE) {
                let pair = cookie
                    .to_str()
                    .unwrap()
                    .split(';')
                    .next()
                    .unwrap()
                    .to_string();
                self.cookie = Some(pair);
            }
            let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap();
            Reply {
                status,
                headers,
                body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            }
        }

        async fn refresh_csrf(&mut self) -> Value {
            let state = self
                .call("GET", "/_openab/console/state", Value::Null)
                .await
                .body;
            self.csrf = state["csrfToken"].as_str().map(str::to_string);
            state
        }
    }

    #[test]
    fn public_urls_normalize_to_the_acp_endpoint() {
        assert_eq!(
            normalize_public_url("https://Host.example").as_deref(),
            Some("wss://host.example/acp")
        );
        assert_eq!(
            normalize_public_url("http://127.0.0.1:18180/").as_deref(),
            Some("ws://127.0.0.1:18180/acp")
        );
        assert_eq!(
            normalize_public_url("wss://h.example/custom/acp?x=1").as_deref(),
            Some("wss://h.example/custom/acp")
        );
        assert_eq!(normalize_public_url("ftp://h.example"), None);
        assert_eq!(normalize_public_url("https://user@h.example"), None);
        assert_eq!(normalize_public_url("h.example"), None);
    }

    #[test]
    fn deep_links_carry_the_url_code_and_expiry() {
        let expires = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
        assert_eq!(
            deep_link(
                "nuphos://connect-runtime?url={url}&code={code}&exp={exp}",
                "wss://h.example/acp",
                "ABC",
                expires
            ),
            "nuphos://connect-runtime?url=wss%3A%2F%2Fh.example%2Facp&code=ABC&exp=1800000000"
        );
    }

    #[tokio::test]
    async fn setup_then_login_mint_revoke_and_change_password() {
        let dir = temp_dir("console");
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let console = new_console(dir.clone(), Duration::from_secs(60));
        let mut client = Client::new(new_app(console.clone(), store.clone()));

        let state = client
            .call("GET", "/_openab/console/state", Value::Null)
            .await
            .body;
        assert_eq!(state["phase"], "setup");
        assert!(state["setupWindowEndsAt"].is_string());

        let short = client
            .call(
                "POST",
                "/_openab/console/setup",
                json!({"password": "short"}),
            )
            .await;
        assert_eq!(short.status, StatusCode::BAD_REQUEST);

        let setup = client
            .call("POST", "/_openab/console/setup", json!({"generate": true}))
            .await;
        assert_eq!(setup.status, StatusCode::OK);
        let password = setup.body["password"].as_str().unwrap().to_string();
        assert!(password.len() >= 43);
        let cookie = setup.headers[header::SET_COOKIE].to_str().unwrap();
        assert!(
            cookie.starts_with("nuphos_console=")
                && cookie.contains("HttpOnly")
                && cookie.contains("SameSite=Strict")
        );
        assert!(!cookie.contains("Secure"), "plain http gets no Secure flag");

        let again = client
            .call("POST", "/_openab/console/setup", json!({"generate": true}))
            .await;
        assert_eq!(again.status, StatusCode::CONFLICT);

        let state = client.refresh_csrf().await;
        assert_eq!(state["phase"], "console");
        assert_eq!(state["initializedBy"], "console");
        assert_eq!(state["publicUrl"], format!("ws://{HOST}/acp"));

        let minted = client
            .call("POST", "/_openab/console/pairing-codes", Value::Null)
            .await;
        assert_eq!(minted.status, StatusCode::OK);
        let code = minted.body["code"].as_str().unwrap();
        assert!(store.pairing.consume(code));

        let issued = store
            .create_pending("Acme".into(), Default::default())
            .unwrap();
        let state = client.refresh_csrf().await;
        assert_eq!(state["bindings"][0]["id"], issued.id);
        assert!(state["bindings"][0].get("transportKeySha256").is_none());
        let revoked = client
            .call(
                "DELETE",
                &format!("/_openab/console/bindings/{}", issued.id),
                Value::Null,
            )
            .await;
        assert_eq!(revoked.status, StatusCode::OK);
        assert!(store.authenticate(&issued.transport_key).is_none());

        let wrong = client
            .call(
                "POST",
                "/_openab/console/password",
                json!({"current": "nope-nope-nope", "next": "another-password-1"}),
            )
            .await;
        assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);
        let changed = client
            .call(
                "POST",
                "/_openab/console/password",
                json!({"current": password, "next": "another-password-1"}),
            )
            .await;
        assert_eq!(changed.status, StatusCode::OK);

        let reopened = console_from(dir);
        assert!(verify_password(
            "another-password-1",
            &reopened.config.read().as_ref().unwrap().file.password_hash
        ));
    }

    fn console_from(dir: PathBuf) -> RuntimeConsole {
        RuntimeConsole::open(dir, None, None, Duration::ZERO).unwrap()
    }

    #[tokio::test]
    async fn writes_need_same_origin_and_the_csrf_token() {
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let mut client = Client::new(new_app(
            new_console(temp_dir("csrf"), Duration::from_secs(60)),
            store,
        ));
        client
            .call(
                "POST",
                "/_openab/console/setup",
                json!({"password": "correct-horse-battery"}),
            )
            .await;

        let no_csrf = client
            .call("POST", "/_openab/console/pairing-codes", Value::Null)
            .await;
        assert_eq!(no_csrf.status, StatusCode::FORBIDDEN);
        client.refresh_csrf().await;
        client.origin = Some("https://evil.example".into());
        let cross = client
            .call("POST", "/_openab/console/pairing-codes", Value::Null)
            .await;
        assert_eq!(cross.status, StatusCode::FORBIDDEN);
        client.origin = None;
        let missing = client
            .call("POST", "/_openab/console/pairing-codes", Value::Null)
            .await;
        assert_eq!(missing.status, StatusCode::FORBIDDEN);
        client.origin = Some(format!("http://{HOST}"));
        let ok = client
            .call("POST", "/_openab/console/pairing-codes", Value::Null)
            .await;
        assert_eq!(ok.status, StatusCode::OK);
        assert_eq!(ok.headers[header::X_FRAME_OPTIONS], "DENY");
        assert_eq!(ok.headers[header::CACHE_CONTROL], "no-store");
    }

    #[tokio::test]
    async fn login_is_rate_limited_and_https_gets_a_host_prefixed_secure_cookie() {
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let console = new_console(temp_dir("login"), Duration::from_secs(60));
        let app = new_app(console, store);
        let mut owner = Client::new(app.clone());
        owner
            .call(
                "POST",
                "/_openab/console/setup",
                json!({"password": "correct-horse-battery"}),
            )
            .await;

        let mut visitor = Client::new(app);
        visitor.https = true;
        for _ in 0..5 {
            let r = visitor
                .call(
                    "POST",
                    "/_openab/console/login",
                    json!({"password": "wrong-password"}),
                )
                .await;
            assert_eq!(r.status, StatusCode::UNAUTHORIZED);
        }
        let limited = visitor
            .call(
                "POST",
                "/_openab/console/login",
                json!({"password": "correct-horse-battery"}),
            )
            .await;
        assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);

        let store = Arc::new(CredentialStore::in_memory(None, None));
        let console = new_console(temp_dir("login2"), Duration::from_secs(60));
        let mut secure = Client::new(new_app(console, store));
        secure.https = true;
        let setup = secure
            .call(
                "POST",
                "/_openab/console/setup",
                json!({"password": "correct-horse-battery"}),
            )
            .await;
        let cookie = setup.headers[header::SET_COOKIE].to_str().unwrap();
        assert!(cookie.starts_with("__Host-nuphos_console=") && cookie.contains("; Secure"));
        let login = secure
            .call(
                "POST",
                "/_openab/console/login",
                json!({"password": "correct-horse-battery"}),
            )
            .await;
        assert_eq!(login.status, StatusCode::OK);
    }

    #[tokio::test]
    async fn logout_ends_every_session_the_browser_presents() {
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let console = new_console(temp_dir("logout"), Duration::from_secs(60));
        let app = new_app(console, store);
        let mut plain = Client::new(app.clone());
        plain
            .call(
                "POST",
                "/_openab/console/setup",
                json!({"password": "correct-horse-battery"}),
            )
            .await;
        let plain_cookie = plain.cookie.clone().unwrap();
        let mut secure = Client::new(app.clone());
        secure.https = true;
        secure
            .call(
                "POST",
                "/_openab/console/login",
                json!({"password": "correct-horse-battery"}),
            )
            .await;
        let secure_cookie = secure.cookie.clone().unwrap();

        let mut both = Client::new(app.clone());
        both.cookie = Some(format!("{secure_cookie}; {plain_cookie}"));
        both.refresh_csrf().await;
        let saved = both.cookie.clone();
        let logout = both
            .call("POST", "/_openab/console/logout", Value::Null)
            .await;
        assert_eq!(logout.status, StatusCode::OK);
        let expired: Vec<_> = logout
            .headers
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|v| v.to_str().unwrap().to_string())
            .collect();
        assert!(expired
            .iter()
            .any(|c| c.starts_with("__Host-nuphos_console=;")));
        assert!(expired.iter().any(|c| c.starts_with("nuphos_console=;")));

        for cookie in [plain_cookie, secure_cookie, saved.unwrap()] {
            let mut probe = Client::new(app.clone());
            probe.cookie = Some(cookie);
            let state = probe
                .call("GET", "/_openab/console/state", Value::Null)
                .await
                .body;
            assert_eq!(state["phase"], "login", "every presented session ended");
        }
    }

    #[tokio::test]
    async fn setup_locks_after_its_window_and_reopens_on_restart() {
        let dir = temp_dir("window");
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let mut locked = Client::new(new_app(
            new_console(dir.clone(), Duration::ZERO),
            store.clone(),
        ));
        let state = locked
            .call("GET", "/_openab/console/state", Value::Null)
            .await
            .body;
        assert_eq!(state["phase"], "locked");
        let refused = locked
            .call("POST", "/_openab/console/setup", json!({"generate": true}))
            .await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);

        let mut restarted = Client::new(new_app(new_console(dir, Duration::from_secs(60)), store));
        let state = restarted
            .call("GET", "/_openab/console/state", Value::Null)
            .await
            .body;
        assert_eq!(state["phase"], "setup");
    }

    #[tokio::test]
    async fn concurrent_setups_have_exactly_one_winner() {
        let dir = temp_dir("race");
        let a = new_console(dir.clone(), Duration::from_secs(60));
        let b = new_console(dir, Duration::from_secs(60));
        let (ra, rb) = tokio::join!(
            a.initialize("first-password-1"),
            b.initialize("second-password-2")
        );
        assert!(ra.is_ok() ^ rb.is_ok(), "{ra:?} {rb:?}");
        assert_eq!(ra.err().or(rb.err()), Some(StatusCode::CONFLICT));
    }

    #[test]
    fn a_legacy_password_file_becomes_the_console_password() {
        let dir = temp_dir("legacy-console");
        let legacy = dir.join("auth-key");
        std::fs::write(&legacy, "legacy-password-0123456789abcdef\n").unwrap();
        let console =
            RuntimeConsole::open(dir.clone(), Some(&legacy), None, Duration::ZERO).unwrap();
        assert_eq!(console.phase(), Phase::Login);
        let config = console.config.read().clone().unwrap();
        assert_eq!(config.by, InitializedBy::LegacyPassword);
        assert!(verify_password(
            "legacy-password-0123456789abcdef",
            &config.file.password_hash
        ));
        assert!(dir.join(CONSOLE_FILE).exists());
    }

    #[test]
    fn a_deployment_key_initializes_without_writing_state() {
        let dir = temp_dir("env-console");
        let console = RuntimeConsole::open(
            dir.clone(),
            None,
            Some("deployment-key-0123456789"),
            Duration::ZERO,
        )
        .unwrap();
        assert_eq!(console.phase(), Phase::Login);
        assert_eq!(
            console.config.read().as_ref().unwrap().by,
            InitializedBy::Deployment
        );
        assert!(!dir.join(CONSOLE_FILE).exists());
    }
}
