//! Pairing: an application trades a short-lived, single-use code for its own binding.
//!
//! The runtime console mints a code; the application (the Nuphos backend) presents it to
//! `POST /_openab/pairing/exchange` and receives a pending binding's transport and control
//! keys. `GET /_openab/bindings/self` and `POST /_openab/bindings/self/revoke` let the
//! holder of a binding's keys check or end it.

use super::runtime_credentials::{sha256_hex, BindingClient, CredentialStore, Role};
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};

const DEFAULT_CODE_TTL_SECS: i64 = 10 * 60;
pub const MAX_ACTIVE_CODES: usize = 5;
const MAX_BODY_BYTES: usize = 16 * 1024;
const MAX_CLIENT_FIELD_CHARS: usize = 200;
const BASE32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Fixed-window attempt counter, per key and overall.
pub struct RateLimiter {
    per_key: u32,
    global: u32,
    window: Duration,
    state: Mutex<(Instant, u32, HashMap<String, u32>)>,
}

impl RateLimiter {
    pub fn new(per_key: u32, global: u32, window: Duration) -> Self {
        Self {
            per_key,
            global,
            window,
            state: Mutex::new((Instant::now(), 0, HashMap::new())),
        }
    }

    /// Count one attempt from `key`; `false` once either budget is spent for this window.
    pub fn allow(&self, key: &str) -> bool {
        let mut state = self.state.lock();
        let (started, total, per_key) = &mut *state;
        if started.elapsed() >= self.window {
            *started = Instant::now();
            *total = 0;
            per_key.clear();
        }
        let count = per_key.entry(key.to_string()).or_insert(0);
        if *total >= self.global || *count >= self.per_key {
            return false;
        }
        *total += 1;
        *count += 1;
        true
    }
}

pub fn base32(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32_ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(BASE32_ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

#[derive(Debug, PartialEq, Eq)]
pub enum MintError {
    TooManyActive,
}

/// Outstanding pairing codes. Memory only: a restart invalidates every code.
pub struct PairingCodes {
    ttl: chrono::Duration,
    codes: Mutex<HashMap<String, DateTime<Utc>>>,
    exchanges: RateLimiter,
}

impl Default for PairingCodes {
    fn default() -> Self {
        Self::new(chrono::Duration::seconds(DEFAULT_CODE_TTL_SECS))
    }
}

impl PairingCodes {
    pub fn new(ttl: chrono::Duration) -> Self {
        Self {
            ttl,
            codes: Mutex::new(HashMap::new()),
            exchanges: RateLimiter::new(5, 10, Duration::from_secs(60)),
        }
    }

    pub fn from_env() -> Self {
        let ttl = std::env::var("OPENAB_RUNTIME_PAIRING_TTL_SECS")
            .ok()
            .and_then(|v| v.trim().parse::<i64>().ok())
            .filter(|secs| *secs > 0)
            .unwrap_or(DEFAULT_CODE_TTL_SECS);
        Self::new(chrono::Duration::seconds(ttl))
    }

    /// A 128-bit code, 26 characters of RFC 4648 base32 (`[A-Z2-7]`), and when it expires.
    pub fn mint(&self) -> Result<(String, DateTime<Utc>), MintError> {
        let now = Utc::now();
        let mut codes = self.codes.lock();
        codes.retain(|_, expires| *expires > now);
        if codes.len() >= MAX_ACTIVE_CODES {
            return Err(MintError::TooManyActive);
        }
        let mut raw = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut raw);
        let code = base32(&raw);
        let expires = now + self.ttl;
        codes.insert(sha256_hex(code.as_bytes()), expires);
        Ok((code, expires))
    }

    /// Spend `code`. It is gone after its first presentation, whatever happens next.
    pub fn consume(&self, code: &str) -> bool {
        let digest = sha256_hex(code.trim().to_ascii_uppercase().as_bytes());
        self.codes
            .lock()
            .remove(&digest)
            .is_some_and(|expires| expires > Utc::now())
    }

    pub fn active(&self) -> usize {
        let now = Utc::now();
        self.codes.lock().values().filter(|e| **e > now).count()
    }
}

/// The first `X-Forwarded-For` hop, else `X-Real-IP`. Only a rate-limit key: a spoofed
/// value can only move the sender into a different bucket of the same global budget.
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .or_else(|| headers.get("x-real-ip").and_then(|v| v.to_str().ok()))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "direct".into())
}

/// The agent this runtime runs, as Nuphos names it, from the image's adapter stamp.
pub fn provider() -> Option<&'static str> {
    let stamp = std::env::var("OPENAB_ADAPTER_VERSION").ok()?;
    if stamp.starts_with("claude-agent-acp") {
        Some("claude-code")
    } else if stamp.starts_with("codex-acp") {
        Some("codex")
    } else {
        None
    }
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
}

fn error(status: StatusCode, code: &str) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({ "error": code })),
    )
        .into_response()
}

fn ok(body: Value) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn store(state: &crate::AppState) -> Option<&Arc<CredentialStore>> {
    state.acp.as_ref().and_then(|c| c.credentials.as_ref())
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|v| {
            v.chars()
                .filter(|c| !c.is_control())
                .take(MAX_CLIENT_FIELD_CHARS)
                .collect::<String>()
        })
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[derive(Deserialize)]
struct ExchangeRequest {
    code: String,
    #[serde(default)]
    client: BindingClient,
}

/// The team name, else the backend's host, whether the origin carries a scheme or not.
fn binding_label(client: &BindingClient) -> String {
    let host = client.backend_origin.as_deref().and_then(|origin| {
        let rest = origin.split_once("://").map_or(origin, |(_, rest)| rest);
        let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
        (!host.is_empty()).then(|| host.to_string())
    });
    client
        .team_name
        .clone()
        .or(host)
        .unwrap_or_else(|| "Nuphos".into())
}

async fn exchange(
    State(state): State<Arc<crate::AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(store) = store(&state) else {
        return error(StatusCode::NOT_FOUND, "not_found");
    };
    if !store.pairing.exchanges.allow(&client_ip(&headers)) {
        warn!("pairing exchange rate-limited");
        return error(StatusCode::TOO_MANY_REQUESTS, "rate_limited");
    }
    let Ok(request) = serde_json::from_slice::<ExchangeRequest>(&body) else {
        return error(StatusCode::BAD_REQUEST, "invalid_request");
    };
    if !store.pairing.consume(&request.code) {
        warn!("pairing exchange rejected: unknown, used or expired code");
        return error(StatusCode::BAD_REQUEST, "invalid_code");
    }
    let raw = request.client;
    let client = BindingClient {
        backend_origin: clean(raw.backend_origin),
        team_id: clean(raw.team_id),
        team_name: clean(raw.team_name),
        paired_by: clean(raw.paired_by),
        runtime_record_id: clean(raw.runtime_record_id),
    };
    let Ok(issued) = store.create_pending(binding_label(&client), client) else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "store_failed");
    };
    info!(binding = %issued.id, "pairing code exchanged for a pending binding");
    ok(json!({
        "bindingId": issued.id,
        "transportKey": issued.transport_key,
        "controlKey": issued.control_key,
        "runtimeInstanceId": store.instance_id(),
        "provider": provider(),
        "pendingUntil": issued.pending_until,
    }))
}

async fn binding_self(State(state): State<Arc<crate::AppState>>, headers: HeaderMap) -> Response {
    let Some(store) = store(&state) else {
        return error(StatusCode::NOT_FOUND, "not_found");
    };
    let Some(principal) = bearer(&headers).and_then(|t| store.authenticate(t)) else {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    match principal.binding_id {
        Some(id) => match store.get(&id) {
            Some(binding) => ok(json!({"bindingId": binding.id, "state": binding.state})),
            None => error(StatusCode::UNAUTHORIZED, "unauthorized"),
        },
        None => ok(json!({"bindingId": null, "state": "active", "source": "deployment"})),
    }
}

async fn revoke_self(State(state): State<Arc<crate::AppState>>, headers: HeaderMap) -> Response {
    let Some(store) = store(&state) else {
        return error(StatusCode::NOT_FOUND, "not_found");
    };
    let Some(principal) = bearer(&headers).and_then(|t| store.authenticate(t)) else {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    if principal.role != Role::Control {
        return error(StatusCode::FORBIDDEN, "control_key_required");
    }
    let Some(id) = principal.binding_id else {
        return error(StatusCode::CONFLICT, "not_revocable");
    };
    if store.revoke(&id).is_err() {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "store_failed");
    }
    info!(binding = %id, "binding revoked by its holder");
    ok(json!({"revoked": true}))
}

/// Routes for pairing and self-service binding checks. Mounted beside `/acp` when the
/// runtime console is enabled.
pub fn routes() -> Router<Arc<crate::AppState>> {
    Router::new()
        .route("/_openab/pairing/exchange", post(exchange))
        .route("/_openab/bindings/self", get(binding_self))
        .route("/_openab/bindings/self/revoke", post(revoke_self))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::acp_server::{AcpConfig, RuntimeJobs};

    #[test]
    fn base32_matches_rfc4648() {
        assert_eq!(base32(b""), "");
        assert_eq!(base32(b"f"), "MY");
        assert_eq!(base32(b"foobar"), "MZXW6YTBOI");
    }

    #[test]
    fn a_binding_is_labelled_by_team_else_backend_host() {
        let origin = |o: &str| BindingClient {
            backend_origin: Some(o.into()),
            ..Default::default()
        };
        assert_eq!(
            binding_label(&origin("https://api.nuphos.example/")),
            "api.nuphos.example"
        );
        assert_eq!(
            binding_label(&origin("api.nuphos.example")),
            "api.nuphos.example"
        );
        assert_eq!(
            binding_label(&origin("api.nuphos.example:8443/x")),
            "api.nuphos.example:8443"
        );
        assert_eq!(binding_label(&origin("")), "Nuphos");
        let named = BindingClient {
            team_name: Some("Acme".into()),
            ..origin("https://api.nuphos.example")
        };
        assert_eq!(binding_label(&named), "Acme");
        assert_eq!(binding_label(&BindingClient::default()), "Nuphos");
    }

    #[test]
    fn codes_are_26_base32_chars_single_use_and_expire() {
        let codes = PairingCodes::default();
        let (code, expires) = codes.mint().unwrap();
        assert_eq!(code.len(), 26);
        assert!(code.bytes().all(|b| BASE32_ALPHABET.contains(&b)));
        assert!(expires > Utc::now());
        assert!(codes.consume(&code));
        assert!(!codes.consume(&code), "a code is single-use");

        let expired = PairingCodes::new(chrono::Duration::seconds(-1));
        let (code, _) = expired.mint().unwrap();
        assert!(!expired.consume(&code));
    }

    #[test]
    fn at_most_five_codes_are_outstanding() {
        let codes = PairingCodes::default();
        for _ in 0..MAX_ACTIVE_CODES {
            codes.mint().unwrap();
        }
        assert_eq!(codes.mint(), Err(MintError::TooManyActive));
        assert_eq!(codes.active(), MAX_ACTIVE_CODES);
    }

    #[test]
    fn rate_limiter_caps_each_key_and_the_total() {
        let limiter = RateLimiter::new(2, 3, Duration::from_secs(60));
        assert!(limiter.allow("a") && limiter.allow("a"));
        assert!(!limiter.allow("a"));
        assert!(limiter.allow("b"));
        assert!(!limiter.allow("c"), "the global budget is spent");
    }

    fn app(store: Arc<CredentialStore>) -> Router {
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
            console: None,
        });
        routes().with_state(Arc::new(state))
    }

    async fn call(
        app: &Router,
        method: &str,
        uri: &str,
        bearer: Option<&str>,
        body: Value,
    ) -> (StatusCode, Value) {
        use tower::ServiceExt;
        let mut request = axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json");
        if let Some(token) = bearer {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let response = app
            .clone()
            .oneshot(
                request
                    .body(axum::body::Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[tokio::test]
    async fn exchange_issues_a_pending_binding_once_per_code() {
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let app = app(store.clone());
        let (code, _) = store.pairing.mint().unwrap();
        let body = json!({"code": code, "client": {
            "backendOrigin": "https://api.nuphos.example",
            "teamId": "t1", "teamName": "Acme\u{7}", "pairedBy": "Ada",
            "runtimeRecordId": "rt_1", "unknown": true
        }});
        let (status, issued) = call(
            &app,
            "POST",
            "/_openab/pairing/exchange",
            None,
            body.clone(),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{issued}");
        for field in [
            "bindingId",
            "transportKey",
            "controlKey",
            "runtimeInstanceId",
            "pendingUntil",
        ] {
            assert!(issued[field].is_string(), "{field} missing: {issued}");
        }
        let binding = store.get(issued["bindingId"].as_str().unwrap()).unwrap();
        assert_eq!(binding.label, "Acme");
        assert_eq!(binding.client.paired_by.as_deref(), Some("Ada"));

        let (status, again) = call(&app, "POST", "/_openab/pairing/exchange", None, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(again["error"], "invalid_code");

        let transport = issued["transportKey"].as_str().unwrap();
        let control = issued["controlKey"].as_str().unwrap();
        let (status, me) = call(
            &app,
            "GET",
            "/_openab/bindings/self",
            Some(transport),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            me["state"], "active",
            "checking the binding is its first use"
        );

        let (status, _) = call(
            &app,
            "POST",
            "/_openab/bindings/self/revoke",
            Some(transport),
            Value::Null,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "only the control key may revoke"
        );
        let (status, _) = call(
            &app,
            "POST",
            "/_openab/bindings/self/revoke",
            Some(control),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, _) = call(
            &app,
            "GET",
            "/_openab/bindings/self",
            Some(control),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn exchange_is_rate_limited_and_rejects_bad_input() {
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let app = app(store);
        let (status, _) = call(
            &app,
            "POST",
            "/_openab/pairing/exchange",
            None,
            json!({"nope": 1}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let mut limited = false;
        for _ in 0..12 {
            let (status, _) = call(
                &app,
                "POST",
                "/_openab/pairing/exchange",
                None,
                json!({"code": "AAAAAAAAAAAAAAAAAAAAAAAAAA"}),
            )
            .await;
            limited |= status == StatusCode::TOO_MANY_REQUESTS;
        }
        assert!(limited);
    }

    #[tokio::test]
    async fn deployment_keys_report_themselves_but_cannot_be_revoked() {
        let control = "c".repeat(40);
        let store = Arc::new(CredentialStore::in_memory(None, Some(control.clone())));
        let app = app(store);
        let (status, me) = call(
            &app,
            "GET",
            "/_openab/bindings/self",
            Some(&control),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(me["source"], "deployment");
        let (status, _) = call(
            &app,
            "POST",
            "/_openab/bindings/self/revoke",
            Some(&control),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        let (status, _) = call(&app, "GET", "/_openab/bindings/self", None, Value::Null).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
