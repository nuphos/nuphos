//! ACP (Agent Client Protocol) Server adapter.
//!
//! Exposes OAB as an ACP-compliant server over WebSocket at `GET /acp`.
//! Any ACP client (Zed, JetBrains, desktop apps, web apps, CLIs) can connect
//! and interact with OAB's multi-agent platform using the standard protocol.
//!
//! Protocol flow:
//!   Client connects via WebSocket → sends `initialize` → `session/new` → `session/prompt`
//!   Server streams back `AgentMessageChunk` notifications, then the prompt response.
//!
//! Internally, prompts are converted to `GatewayEvent` and dispatched through OAB's
//! existing event pipeline. Replies (`GatewayReply`) are translated back into ACP
//! notifications and streamed to the client.

#[path = "session_automation.rs"]
mod automation;
pub use automation::{observe_runtime_reply, SessionAutomation};

#[path = "runtime_login.rs"]
pub(crate) mod runtime_login;
pub use runtime_login::LoginCommand;

#[path = "runtime_terminal.rs"]
mod runtime_terminal;

#[path = "runtime_job.rs"]
pub(crate) mod runtime_job;
pub use runtime_job::RuntimeJobs;
#[path = "runtime_usage.rs"]
mod runtime_usage;

use super::runtime_credentials::{CredentialStore, Principal, Role};
use super::session_owners::Claim;
use crate::schema::*;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, info, warn};
use uuid::Uuid;

/// ACP wire protocol MAJOR version (an integer), returned from `initialize`.
/// Tracks the official schema — see `docs/acp-official-methods.md`.
const ACP_PROTOCOL_VERSION: u32 = 1;

/// WebSocket close code sent to a connection whose binding was revoked.
pub const BINDING_REVOKED_CLOSE_CODE: u16 = 4401;

/// Lightweight per-connection resource caps: turn unbounded client-driven growth into
/// a deterministic overload error. Full backpressure (bounded outbound channel), idle
/// eviction, and global connection/worker limits are a follow-up (review F6, roadmap).
const MAX_SESSIONS_PER_CONNECTION: usize = 128;
const MAX_INFLIGHT_PROMPTS: usize = 32;
/// Cap on concurrently-establishing tunnels per connection.
///
/// Separate from [`MAX_INFLIGHT_PROMPTS`] on purpose. These tasks used to share one budget, so a
/// client with several slow `mcp/connect`s outstanding could exhaust it and make ordinary
/// `session/prompt` calls fail with "Too many in-flight prompts" — an error naming a limit the
/// client had not reached, for work it had not asked for. `MAX_ACP_SERVERS_PER_SESSION` bounds one
/// session's declarations; this bounds every session's establishes on a connection at once.
const MAX_INFLIGHT_ESTABLISHES: usize = 64;
/// Per-chunk idle timeout for a prompt turn, in `handle_session_prompt`.
///
/// Named rather than left inline because it is the effective ceiling on anything a turn waits for:
/// the tunnel's own timeout has to stay strictly beneath it, and `[mcp] tunnel_timeout_seconds`
/// documents itself against this value. As a bare literal in the middle of a loop it was invisible
/// to exactly the person who needed it — the operator raising the tunnel timeout into it.
///
/// Default when `OPENAB_ACP_IDLE_TIMEOUT_SECS` is unset or invalid. The effective value comes from
/// [`acp_prompt_idle_timeout_secs`]; anything configured above the effective value is silently
/// capped there, which is why the config path warns rather than letting a larger value look
/// effective.
///
/// Timeout ordering contract (each layer strictly below the next, so the layer that owns the
/// failure also reports it): gateway idle timeout (this) < pool `prompt_hard_timeout_secs` <
/// client per-prompt timeout (Nuphos: 15 min).
pub const ACP_PROMPT_IDLE_TIMEOUT_SECS: u64 = 180;

/// Floor for the env override: below this a single slow chunk boundary would spuriously kill
/// healthy turns.
const ACP_PROMPT_IDLE_TIMEOUT_MIN_SECS: u64 = 30;

static ACP_PROMPT_IDLE_TIMEOUT: std::sync::OnceLock<u64> = std::sync::OnceLock::new();

/// The effective per-chunk idle timeout for a prompt turn: `OPENAB_ACP_IDLE_TIMEOUT_SECS` when it
/// parses to a value >= the floor, else the default. Read once per process.
pub fn acp_prompt_idle_timeout_secs() -> u64 {
    *ACP_PROMPT_IDLE_TIMEOUT.get_or_init(|| {
        let resolved = idle_timeout_from_env(
            std::env::var("OPENAB_ACP_IDLE_TIMEOUT_SECS")
                .ok()
                .as_deref(),
        );
        if resolved != ACP_PROMPT_IDLE_TIMEOUT_SECS {
            info!(
                idle_timeout_secs = resolved,
                "ACP prompt idle timeout overridden via env"
            );
        }
        resolved
    })
}

/// Pure resolution of the env override, testable without process-global env: a missing,
/// non-numeric, or below-floor value falls back to the default rather than guessing.
pub fn idle_timeout_from_env(raw: Option<&str>) -> u64 {
    match raw.and_then(|value| value.trim().parse::<u64>().ok()) {
        Some(value) if value >= ACP_PROMPT_IDLE_TIMEOUT_MIN_SECS => value,
        _ => ACP_PROMPT_IDLE_TIMEOUT_SECS,
    }
}

/// Whether a configured tunnel timeout is overtaken by the idle timeout, and so cannot decide the
/// outcome.
///
/// Split out from the warning so the boundary is testable without capturing log output: the
/// interesting part is one comparison, and an inverted `>=` would be silent in exactly the case it
/// exists to report.
pub fn tunnel_timeout_is_ineffective(configured_secs: u64) -> bool {
    configured_secs >= acp_prompt_idle_timeout_secs()
}

/// Warn when a configured tunnel timeout cannot take effect because the idle timeout above overtakes
/// it.
///
/// Lives here, next to the number it is about, rather than in the binary that reads the config. The
/// edge is unchanged — the binary already depends on this crate — but the caller no longer has to
/// know what the ceiling is or which direction to compare, so when that constant changes or becomes
/// configurable there is one place to edit instead of two. This is a relocation of the invariant, not
/// a removal of coupling: the value still has to be handed in, because this crate never sees the
/// config.
pub fn warn_if_tunnel_timeout_is_ineffective(configured_secs: u64) {
    if tunnel_timeout_is_ineffective(configured_secs) {
        warn!(
            configured = configured_secs,
            effective_ceiling = acp_prompt_idle_timeout_secs(),
            "[mcp] tunnel_timeout_seconds is at or above the ACP prompt idle timeout, which is not \
             configurable at runtime — the turn ends there first, so this value cannot take effect"
        );
    }
}
/// Cap on `type:acp` servers a single session may declare (review R3-F1).
///
/// Every declaration costs a spawned task, a pending `mcp/connect` holding a 30s timeout, and an
/// outbound frame. Declarations are tiny, so thousands fit inside the 1 MiB limit that applies to
/// a `session/new` frame — without a cap, one accepted request bursts all of that at once. Eight
/// is far above any real client (the reference client declares one) and far below what hurts.
const MAX_ACP_SERVERS_PER_SESSION: usize = 8;
const MAX_FRAME_BYTES: usize = 8 << 20; // 8 MiB — browser-tool results (e.g. screenshots) exceed 1 MiB
/// The method of a parsed inbound frame when it exceeds the limit for its kind, else `None`.
///
/// Only client **responses** — `id` present, no `method` — carry tunnel results and may use the
/// full [`MAX_FRAME_BYTES`]. Everything method-bearing is a client request or notification and is
/// held to [`MAX_NON_TUNNEL_FRAME_BYTES`].
fn oversized_for_its_kind(len: usize, raw: &Value) -> Option<&str> {
    let method = raw.get("method").and_then(Value::as_str)?;
    (len > MAX_NON_TUNNEL_FRAME_BYTES).then_some(method)
}

/// Ceiling for every inbound frame that is **not** a tunnel result (review F2).
///
/// The 8 MiB allowance above exists for browser tool results, and those arrive as client
/// *responses* to our server-initiated `mcp/message` requests — `id` present, no `method`.
/// Nothing else needs it: capping method-bearing frames back at the pre-existing 1 MiB stops the
/// raise from being usable to hold `MAX_INFLIGHT_PROMPTS` × 8 MiB of prompt text per connection.
const MAX_NON_TUNNEL_FRAME_BYTES: usize = 1 << 20; // 1 MiB
/// JSON-RPC implementation-defined server error for a hit resource cap.
const ACP_OVERLOADED: i32 = -32000;

/// WebSocket subprotocol prefix that carries the bearer token from a browser client
/// (browsers cannot set an `Authorization` header on a WS handshake, but they CAN offer
/// subprotocols via `new WebSocket(url, protocols)`). The client offers
/// `Sec-WebSocket-Protocol: openab.bearer.<token>, acp.v1`; the server extracts the token
/// and echoes the real `acp.v1` subprotocol so the handshake completes. This keeps the
/// token OUT of the URL — the de facto browser-WS bearer pattern (as used by the
/// Kubernetes API server). Non-browser clients should prefer `Authorization: Bearer`.
const BEARER_SUBPROTOCOL_PREFIX: &str = "openab.bearer.";
/// The real ACP subprotocol echoed back on a successful upgrade.
const ACP_SUBPROTOCOL: &str = "acp.v1";

/// Extract the bearer token from a `Sec-WebSocket-Protocol` offer (the
/// `openab.bearer.<token>` entry), if present.
fn subprotocol_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .and_then(|list| {
            list.split(',')
                .map(str::trim)
                .find_map(|p| p.strip_prefix(BEARER_SUBPROTOCOL_PREFIX))
        })
}

/// Extract the transport bearer key from a WS upgrade request, in priority order:
///   1. `Authorization: Bearer <token>` — non-browser clients (cleanest).
///   2. `Sec-WebSocket-Protocol: openab.bearer.<token>, acp.v1` — browsers (keeps the token
///      out of the URL; the de facto browser-WS bearer pattern).
///
/// The legacy `?token=<token>` query fallback was removed (R17-F2): it leaks the key into
/// URLs / access logs / history, so only these two header-borne sources carry the bearer.
fn ws_bearer_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| subprotocol_token(headers))
}

/// RFC 6455 subprotocol values must be RFC 7230 `token`s. `tchar` = ALPHA / DIGIT /
/// `!#$%&'*+-.^_`|~`. A key with any char outside this set (e.g. base64 `/` or `=`)
/// cannot ride the `openab.bearer.<token>` subprotocol on a strict browser handshake.
fn is_ws_subprotocol_token_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b)
}

// ---------------------------------------------------------------------------
// ACP Configuration
// ---------------------------------------------------------------------------

pub struct AcpConfig {
    pub auth_key: Option<String>,
    /// Independent operator credential. Never exposed to ordinary ACP clients.
    pub control_key: Option<String>,
    /// Browser `Origin`s allowed to drive `/acp` in keyless loopback mode (from
    /// `OPENAB_ACP_ALLOWED_ORIGINS`, comma-separated). Empty by default → every
    /// browser-set `Origin` is rejected; non-browser clients (no `Origin`) are unaffected.
    pub allowed_origins: Vec<String>,
    /// Command `_openab/runtime/login` runs to drive a provider's interactive sign-in
    /// (`OPENAB_RUNTIME_LOGIN_COMMAND`, whitespace-separated argv). Unset → the method
    /// reports that this runtime has no sign-in.
    pub login_command: Option<LoginCommand>,
    /// File whose presence means the provider CLI in this container holds a credential
    /// (`OPENAB_RUNTIME_AUTH_FILE`). Unset → `_openab/runtime/state` reports
    /// `authenticated: null`, which is "OpenAB cannot tell", not "signed out".
    pub auth_file: Option<String>,
    /// Allowlisted commands `_openab/runtime/job` may run (`OPENAB_RUNTIME_JOBS`) and the
    /// limits that bound them.
    pub runtime_jobs: RuntimeJobs,
    /// Volumes whose used/total bytes `_openab/runtime/state` reports
    /// (`OPENAB_RUNTIME_DISK_PATHS`, comma-separated). Empty → disk usage is `null`.
    pub disk_paths: Vec<String>,
    /// Per-binding credentials (`OPENAB_RUNTIME_CONSOLE`). When set, every `/acp` bearer is
    /// resolved here, deployment keys included.
    pub credentials: Option<Arc<CredentialStore>>,
    pub console: Option<Arc<super::runtime_console::RuntimeConsole>>,
}

impl AcpConfig {
    pub fn from_env() -> Option<Self> {
        let enabled = std::env::var("OPENAB_ACP_ENABLED")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        if !enabled {
            return None;
        }
        // Treat an empty value as unset (an empty string is not a usable key).
        let auth_key = std::env::var("OPENAB_ACP_AUTH_KEY")
            .ok()
            .filter(|k| !k.is_empty());
        match auth_key {
            None if super::runtime_credentials::console_enabled() => {}
            None => warn!(
                "OPENAB_ACP_AUTH_KEY not set — /acp is only served on a loopback bind; a \
                 non-loopback bind will refuse to mount it (set a key to expose it)"
            ),
            Some(ref key) if !key.bytes().all(is_ws_subprotocol_token_char) => warn!(
                "OPENAB_ACP_AUTH_KEY contains characters outside the WebSocket subprotocol \
                 token set (RFC 6455) — a browser passing it via `Sec-WebSocket-Protocol: \
                 openab.bearer.<token>` may fail the handshake (base64 `/` and `=` padding \
                 are the usual offenders). Prefer a key in [A-Za-z0-9._~+-]; the \
                 `Authorization: Bearer` and `?token=` paths are unaffected"
            ),
            Some(_) => {}
        }
        // Browser-origin allowlist for keyless loopback mode. A WS handshake bypasses the
        // browser same-origin policy, so without this any web page could drive a keyless
        // `ws://127.0.0.1/acp`. Comma-separated; blanks trimmed. Default empty blocks all
        // browser origins (a non-browser client sends no `Origin` and is unaffected).
        let allowed_origins = std::env::var("OPENAB_ACP_ALLOWED_ORIGINS")
            .ok()
            .map(|v| {
                v.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let control_key = std::env::var("OPENAB_ACP_CONTROL_KEY")
            .ok()
            .filter(|key| key.len() >= 32 && Some(key) != auth_key.as_ref());
        let login_command = std::env::var("OPENAB_RUNTIME_LOGIN_COMMAND")
            .ok()
            .as_deref()
            .and_then(runtime_login::parse_login_command);
        let auth_file = std::env::var("OPENAB_RUNTIME_AUTH_FILE")
            .ok()
            .filter(|path| !path.trim().is_empty());
        let credentials =
            super::runtime_credentials::from_env(auth_key.as_ref(), control_key.as_ref());
        let console = credentials
            .as_ref()
            .and_then(|_| super::runtime_console::from_env(auth_key.as_ref()));
        Some(Self {
            auth_key,
            control_key,
            allowed_origins,
            login_command,
            auth_file,
            runtime_jobs: RuntimeJobs::from_env(),
            disk_paths: std::env::var("OPENAB_RUNTIME_DISK_PATHS")
                .map(|v| {
                    v.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            credentials,
            console,
        })
    }
}

/// Whether the provider CLI in this container holds a credential. `None` when no
/// `OPENAB_RUNTIME_AUTH_FILE` is configured — an operator who cannot answer the question
/// must not be told "signed out", because a container can carry its own credential in a
/// form OpenAB never sees.
pub(crate) fn runtime_authenticated(state: &crate::AppState) -> Option<bool> {
    let path = state.acp.as_ref()?.auth_file.as_ref()?;
    Some(std::fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.len() > 0))
}

/// Whether a **keyless-mode** WS upgrade may proceed given its `Origin` header. WS
/// handshakes are exempt from the browser same-origin policy, so on a keyless loopback
/// bind any web page could otherwise drive `/acp`. A request with no `Origin` (a
/// non-browser client) is allowed; a browser-set `Origin` must be explicitly allowlisted
/// via `OPENAB_ACP_ALLOWED_ORIGINS` (default empty → every browser origin blocked). Keyed
/// binds authenticate via the bearer key and never reach this check.
fn acp_origin_ok(origin: Option<&str>, allowed_origins: &[String]) -> bool {
    match origin {
        None => true,
        Some(o) => allowed_origins.iter().any(|a| a == o),
    }
}

/// Whether the listen address binds a loopback interface (`127.0.0.0/8`, `::1`, or
/// `localhost`). An unknown / unparseable host is treated as non-loopback (fail safe).
fn bind_is_loopback(listen_addr: &str) -> bool {
    let host = listen_addr
        .rsplit_once(':')
        .map(|(h, _)| h)
        .unwrap_or(listen_addr)
        .trim_matches(|c| c == '[' || c == ']'); // strip IPv6 brackets
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

/// Whether `/acp` may be mounted for the given auth key and bind address. A non-empty
/// transport key, or a credential store (which rejects every upgrade until a binding
/// exists), always suffices. Without a key, fail-open is permitted ONLY on a
/// loopback bind; any non-loopback bind (`0.0.0.0`, a LAN IP, a LoadBalancer) requires
/// `OPENAB_ACP_AUTH_KEY` so an unauthenticated agent endpoint is never exposed to the
/// network. Returns `Err(reason)` when the endpoint must not be mounted.
pub fn acp_auth_ok_for_bind(
    auth_key: Option<&str>,
    credential_store: bool,
    listen_addr: &str,
) -> Result<(), String> {
    if credential_store || auth_key.map(|k| !k.is_empty()).unwrap_or(false) {
        return Ok(());
    }
    if bind_is_loopback(listen_addr) {
        return Ok(());
    }
    Err(format!(
        "OPENAB_ACP_AUTH_KEY is required to serve /acp on a non-loopback address \
         ({listen_addr}); refusing to expose an unauthenticated agent endpoint"
    ))
}

/// Incremental text to stream, given the bytes already sent (`sent_len`) and the
/// latest full-text snapshot. Slices via `str::get` (never byte-index `[..]`), so a
/// `sent_len` that lands mid-codepoint — possible with CJK / 顏文字 / emoji only on a
/// non-append snapshot rewrite — yields `None` (caller skips the frame; the next
/// snapshot re-covers) instead of panicking. In the normal append case `sent_len` is
/// always the byte length of a prior valid snapshot and therefore a char boundary of
/// the new text, so a multi-byte codepoint is always emitted whole, never split.
/// Returns `None` when there is nothing new to send.
fn stream_delta(sent_len: usize, full_text: &str) -> Option<&str> {
    match full_text.get(sent_len..) {
        Some(d) if !d.is_empty() => Some(d),
        _ => None,
    }
}

/// Whether ACP frame tracing is on (`OPENAB_ACP_TRACE=1|true`). When set, every
/// JSON-RPC frame on the upstream client↔gateway hop is logged (at `debug!`) in both
/// directions (`dir="in"` / `dir="out"`).
///
/// **This is an opt-in debugging tool that records message CONTENT** — prompts, replies,
/// and negotiated capabilities appear in the logs (truncated, see `trace_frame`). It is
/// off by default and emits at `debug!` so it never surfaces at the default log level;
/// only enable it in a trusted environment when you need to inspect real ACP traffic
/// (e.g. to validate the generated-type round-trip against what clients/agents emit).
pub(crate) fn acp_trace_enabled() -> bool {
    std::env::var("OPENAB_ACP_TRACE")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

/// Truncate a frame for trace logging so a large prompt/reply doesn't dump a huge line
/// (and doesn't record the *complete* content). Keeps the first `CAP` scalar values.
fn trace_frame(s: &str) -> std::borrow::Cow<'_, str> {
    if serde_json::from_str::<Value>(s)
        .ok()
        .and_then(|v| {
            v["method"]
                .as_str()
                .map(|m| m.starts_with("_openab/runtime/terminal/"))
        })
        .unwrap_or(false)
    {
        return std::borrow::Cow::Borrowed("[runtime terminal frame redacted]");
    }
    const CAP: usize = 512;
    let total = s.chars().count();
    if total <= CAP {
        return std::borrow::Cow::Borrowed(s);
    }
    let end = s.char_indices().nth(CAP).map_or(s.len(), |(i, _)| i);
    std::borrow::Cow::Owned(format!("{}…(+{} chars)", &s[..end], total - CAP))
}

/// A steer carries text plus references to files the host already placed on the
/// runtime. A `resource_link` needs both `name` and `uri`, as `session/prompt`
/// requires (R17-F3b), and must be a local `file:` URI: steering forwards local
/// attachments only, never a remote reference.
fn steering_prompt(params: &Value) -> Option<&Vec<Value>> {
    params["prompt"].as_array().filter(|blocks| {
        !blocks.is_empty()
            && blocks.iter().all(|b| match b["type"].as_str() {
                Some("text") => b["text"].as_str().is_some_and(|s| !s.trim().is_empty()),
                Some("resource_link") => {
                    b["name"].as_str().is_some()
                        && b["uri"].as_str().and_then(|uri| uri.get(..8)).is_some_and(
                            |scheme| scheme.eq_ignore_ascii_case("file:///"),
                        )
                }
                _ => false,
            })
    })
}

/// Validate a request's `params` against a generated ACP request type `T`, returning a
/// JSON-RPC `-32602` message when a required field is missing or malformed. This checks
/// shape only — the base validates `cwd`/`mcpServers` for conformance but does not yet
/// propagate them (see the base ADR §5); missing `params` is itself invalid.
fn validate_params<T: serde::de::DeserializeOwned>(params: Option<&Value>) -> Result<(), String> {
    let value = params.cloned().unwrap_or(Value::Null);
    serde_json::from_value::<T>(value)
        .map(|_| ())
        .map_err(|e| format!("Invalid params: {e}"))
}

// ---------------------------------------------------------------------------
// ACP Session tracking
// ---------------------------------------------------------------------------

/// Tracks an active ACP session.
struct AcpSession {
    /// Channel ID used in GatewayEvent (maps replies back to this session)
    channel_id: String,
    /// Whether a prompt is currently in-flight for this session
    busy: bool,
    /// Local interrupt signal for the in-flight prompt, if any. Client
    /// `session/cancel` bypasses this and waits for the inner runtime's terminal
    /// response; this handle remains available for connection-local teardown.
    cancel: Option<Arc<tokio::sync::Notify>>,
    /// Client-declared `"type":"http"` mcpServers entries (raw JSON), forwarded
    /// verbatim to core on each prompt. Empty unless OPENAB_ACP_MCP_SERVERS is on.
    mcp_servers: Vec<serde_json::Value>,
    /// Client-supplied session `_meta` object (raw JSON), forwarded verbatim to
    /// core on each prompt. `None` unless OPENAB_ACP_MCP_SERVERS is on.
    session_meta: Option<serde_json::Value>,
    /// This connection's permission-request return path for the session. Kept in
    /// connection-local state so an idle sink handoff can atomically install the
    /// prompting connection's handle instead of retaining another replica's path.
    permission_relay: Option<ClientRequestHandle>,
}

/// A client-declared MCP-over-ACP server (the RFD `"type":"acp"` `mcpServers` entry). Not in
/// the generated schema (the RFD is a proposal), so parsed from raw params.
#[derive(Debug, Clone, PartialEq)]
struct AcpMcpServer {
    id: String,
    name: String,
}

/// Extract the `"type":"acp"` entries from a `session/new` / `session/resume` params
/// `mcpServers` array. Only the `acp`-transport ones are tunnelled over this WS.
///
/// http/sse/stdio entries are **dropped, and nothing else ever sees them**. This used to say they
/// are "ignored here — the agent connects to those itself", which describes a hand-off that does
/// not exist: `session/new` calls this, keeps the `acp` entries, and then calls
/// `handle_session_new(&sessions, id)` without passing `req.params` anywhere. There is no
/// downstream consumer. That sentence had already misled a reader who reasoned from it before
/// checking, which is why `mcpCapabilities` now advertises `http: false` and `sse: false`.
fn parse_acp_mcp_servers(params: Option<&Value>) -> Vec<AcpMcpServer> {
    params
        .and_then(|p| p.get("mcpServers"))
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|e| e.get("type").and_then(Value::as_str) == Some("acp"))
                .filter_map(|e| {
                    Some(AcpMcpServer {
                        id: e.get("id").and_then(Value::as_str)?.to_string(),
                        name: e.get("name").and_then(Value::as_str)?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Validate a session's declared `type:acp` servers before any of them costs anything.
///
/// Returns the list to act on, or an error message to reject the whole `session/new` /
/// `session/resume` with. Callers must run this **before** inserting the session or spawning
/// tunnels: the point is that an over-declaring request never reaches the work.
///
/// Duplicate ids collapse to the first occurrence. A repeated id would otherwise spawn two tunnels
/// racing for one registry key, where the loser is a task and a pending `mcp/connect` that exist
/// only to be overwritten. Entries missing `id` or `name` were already dropped by
/// `parse_acp_mcp_servers`, so after this the list is unique and complete.
fn accept_acp_servers(servers: Vec<AcpMcpServer>) -> Result<Vec<AcpMcpServer>, String> {
    let mut seen = std::collections::HashSet::new();
    let deduped: Vec<AcpMcpServer> = servers
        .into_iter()
        .filter(|s| seen.insert(s.id.clone()))
        .collect();
    if deduped.len() > MAX_ACP_SERVERS_PER_SESSION {
        return Err(format!(
            "Too many type:acp servers declared ({}, max {MAX_ACP_SERVERS_PER_SESSION})",
            deduped.len()
        ));
    }
    Ok(deduped)
}

/// Extract the `"type":"http"` entries of a `mcpServers` array as raw JSON, for
/// verbatim passthrough to the inner agent session. Capped at
/// `MAX_ACP_SERVERS_PER_SESSION` (extras dropped, not an error).
fn parse_http_mcp_servers(params: Option<&Value>) -> Vec<serde_json::Value> {
    params
        .and_then(|p| p.get("mcpServers"))
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|e| e.get("type").and_then(Value::as_str) == Some("http"))
                .take(MAX_ACP_SERVERS_PER_SESSION)
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// Upper bound on a forwarded session `_meta` object (serialized bytes), so a
/// client cannot bloat the gateway event channel through it.
const MAX_SESSION_META_BYTES: usize = 256 * 1024;

/// Extract the `_meta` object of session/new or session/resume params as raw
/// JSON, for verbatim passthrough to the inner agent session. Non-objects are
/// ignored; an object over `MAX_SESSION_META_BYTES` is dropped with a warning.
fn parse_session_meta(params: Option<&Value>) -> Option<serde_json::Value> {
    let meta = params
        .and_then(|p| p.get("_meta"))
        .filter(|m| m.is_object())?;
    let bytes = serde_json::to_vec(meta)
        .map(|v| v.len())
        .unwrap_or(usize::MAX);
    if bytes > MAX_SESSION_META_BYTES {
        warn!(
            bytes,
            max = MAX_SESSION_META_BYTES,
            "ACP: session _meta exceeds size cap; dropped"
        );
        return None;
    }
    Some(meta.clone())
}

/// `session/prompt` `_meta` keys that carry a replacement for the session's
/// stored passthrough values, with the same semantics as `session/resume`
/// `_meta` / `mcpServers`: only an object (resp. array) replaces. Clients use
/// them to hand a live session short-lived credentials without re-resuming.
const PROMPT_SESSION_META_KEY: &str = "dev.openab/sessionMeta";
const PROMPT_MCP_SERVERS_KEY: &str = "dev.openab/mcpServers";

fn refresh_session_passthrough(session: &mut AcpSession, params: Option<&Value>) {
    let Some(meta) = params.and_then(|p| p.get("_meta")) else {
        return;
    };
    if let Some(servers) = meta.get(PROMPT_MCP_SERVERS_KEY).filter(|v| v.is_array()) {
        session.mcp_servers = parse_http_mcp_servers(Some(&json!({ "mcpServers": servers })));
    }
    if let Some(next) = meta.get(PROMPT_SESSION_META_KEY).filter(|v| v.is_object()) {
        if let Some(next) = parse_session_meta(Some(&json!({ "_meta": next }))) {
            session.session_meta = Some(next);
        }
    }
}

const PERMISSION_POLICY_META_KEY: &str = "dev.openab/permissionPolicy";
const PERMISSION_RELAY_TIMEOUT_SECS: u64 = 900;
/// Covers a client noticing its lost connection and reattaching (Nuphos: up to ~10 s to detect a
/// moved device tunnel, then resume retries at 0, 1, 2, 5 and 10 s).
const PERMISSION_REATTACH_GRACE: std::time::Duration = std::time::Duration::from_secs(30);

fn permission_relay_requested(params: Option<&Value>) -> bool {
    params
        .and_then(|p| p.get("_meta"))
        .and_then(|meta| meta.get(PERMISSION_POLICY_META_KEY))
        .and_then(Value::as_str)
        == Some("relay")
}

/// Env gate for the ACP passthrough (`OPENAB_ACP_MCP_SERVERS=true|1`): http
/// mcpServers entries and the session `_meta` object. Read once per connection;
/// handlers take the value as a parameter so tests never mutate process env.
fn acp_mcp_servers_enabled() -> bool {
    std::env::var("OPENAB_ACP_MCP_SERVERS")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

pub enum ReplyChunk {
    /// Incremental text snapshot (full text so far)
    Text(String),
    /// Raw agent-side `session/update` payload (thought chunk, tool_call, …)
    /// relayed verbatim to the ACP client.
    Update(serde_json::Value),
    /// Agent failed (runtime error, process exit, or hard timeout).
    Error(String),
    /// Agent finished responding, with the inner runtime's terminal reason.
    Done(Option<crate::adapters::acp_schema::StopReason>),
}

/// One active turn's reply sink plus the originating `GatewayEvent` id used to fence
/// stale replies. After a prompt times out / is cancelled, the next prompt on the same
/// session reuses the same deterministic `channel_id`; a late reply from the superseded
/// turn carries that turn's `evt_<uuid>` in `GatewayReply.reply_to`, so matching it
/// against `turn_id` drops it instead of mis-delivering into the new prompt's stream.
pub struct ReplySink {
    /// Originating `GatewayEvent.event_id` (`evt_<uuid>`), round-tripped as `reply_to`.
    pub turn_id: Option<String>,
    pub tx: Option<mpsc::UnboundedSender<ReplyChunk>>,
    /// Outer ACP session id used for session-level updates while no prompt is active.
    pub session_id: String,
    /// Connection-lifetime output path. Unlike `tx`, this remains valid between prompts.
    pub out_tx: mpsc::UnboundedSender<String>,
    /// The `acp_conn_*` id of the WebSocket connection that installed this sink.
    ///
    /// Teardown removes only what it owns. "Remove the keys for my sessions" is not enough: a
    /// client that reconnects and resumes takes over the same `channel_id`, so a slow cleanup from
    /// the old connection would delete the *successor's* live sink and silently stop its replies.
    pub owner: String,
    /// Age of the CONNECTION that installed this sink (`connection_generation`, from
    /// [`TUNNEL_GENERATION`], retained as connection-ownership metadata.
    /// Prompt ownership itself is ordered by active-vs-idle state: an active turn cannot be
    /// displaced, while an idle route can be claimed by any still-live connection.
    pub generation: u64,
    permission_relay: Option<ClientRequestHandle>,
}

#[derive(Clone)]
struct ClientRequestHandle {
    out_tx: mpsc::UnboundedSender<String>,
    pending: Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: Arc<AtomicU64>,
}

/// Resolve a client-declared server NAME to the registry key of its tunnel, for one channel.
///
/// Lives here, beside the code that maintains the uniqueness it relies on, and that is the whole
/// point. The caller used to enumerate the channel's tunnels and take the first name match, which
/// was correct only because same-name entries cannot coexist — an invariant established by the
/// single insert site below, in another crate's line of sight, with nothing binding the two. Weaken
/// that eviction and a "take the first" caller does not fail, it silently picks an arbitrary tunnel.
///
/// Moving the resolution next to the invariant removes the distance rather than documenting it.
///
/// If two ever do coexist, this picks the newest by the SAME ordering that produced the invariant
/// and warns. It deliberately does not error: answering "ambiguous, pass a server_id" is the
/// behaviour ADR §6.1 exists to avoid, because it locks a client out of its own tools on every
/// reconnect. A hard stop is the wrong response to a soft inconsistency.
pub fn resolve_by_name(
    registry: &AcpTunnelRegistry,
    channel_id: &str,
    server_name: &str,
) -> Option<String> {
    // One pass, no allocation, and `rank > best` says which direction wins out loud. The first
    // version collected into a `Vec`, sorted it, and took the last element — the cost of that was
    // never the problem at one or two entries, but it asked the reader to re-derive whether the
    // direction was right, and direction is what this file has got wrong repeatedly: the rank
    // polarity, `<=` against `<`, which of the two numbers is compared first. A shape that already
    // holds a `Vec` under the lock also invites the next person to do more work in here.
    let reg = registry.lock().unwrap_or_else(|e| e.into_inner());
    let mut count = 0usize;
    let mut best: Option<(&String, (u64, u64))> = None;
    for ((c, id), h) in reg.iter() {
        if c != channel_id || h.server_name != server_name {
            continue;
        }
        count += 1;
        let rank = (h.connection_generation, h.generation);
        if best.is_none_or(|(_, current)| rank > current) {
            best = Some((id, rank));
        }
    }
    if count > 1 {
        warn!(
            channel = %redact_id(channel_id), server_name, count,
            "ACP: more than one tunnel is registered under one declared name — registry uniqueness \
             was broken upstream; routing to the newest attach"
        );
    }
    best.map(|(id, _)| id.clone())
}

/// The distinct declared **names** of tunnels currently attached to `channel_id`.
///
/// Drives the facade's discovery now that there is no operator allowlist to enumerate (D-29). It
/// returns names, never `(name, id)`: the caller resolves each through [`resolve_by_name`], so the
/// name→id collapse stays in the one place `74315a60` consolidated it — this is not a second route
/// back to the enumerate-and-match hazard that commit removed. Deduplicated because a same-name
/// collision (two tunnels mid-eviction) is one server to discover; `resolve_by_name` selects the
/// ranked winner when discovery resolves it.
pub fn attached_server_names(registry: &AcpTunnelRegistry, channel_id: &str) -> Vec<String> {
    let reg = registry.lock().unwrap_or_else(|e| e.into_inner());
    let mut names: Vec<String> = reg
        .iter()
        .filter(|((c, _), _)| c == channel_id)
        .map(|(_, h)| h.server_name.clone())
        .collect();
    names.sort();
    names.dedup();
    names
}

/// Registry of active ACP sessions: channel_id → reply sink.
/// Uses std::sync::Mutex because all operations are fast CPU-bound
/// (insert/remove/get) and never hold the lock across .await.
pub type AcpReplyRegistry = Arc<std::sync::Mutex<HashMap<String, ReplySink>>>;

pub fn new_reply_registry() -> AcpReplyRegistry {
    Arc::new(std::sync::Mutex::new(HashMap::new()))
}

/// Install an idle connection-level route for `channel_id` without displacing an active turn.
/// The most recent successful new/resume owns autonomous updates while the session is idle, but
/// connection age is not a permanent lease: active-active clients may legitimately alternate turns.
fn install_reply_sink(registry: &AcpReplyRegistry, channel_id: &str, sink: ReplySink) -> bool {
    let mut reg = registry.lock().unwrap_or_else(|e| e.into_inner());
    match reg.get(channel_id) {
        Some(existing) if existing.turn_id.is_some() => false,
        _ => {
            reg.insert(channel_id.to_string(), sink);
            true
        }
    }
}

fn activate_reply_sink(registry: &AcpReplyRegistry, channel_id: &str, claim: ReplySink) -> bool {
    let mut reg = registry.lock().unwrap_or_else(|e| e.into_inner());
    match reg.get(channel_id) {
        Some(existing) if existing.turn_id.is_some() => false,
        _ => {
            reg.insert(channel_id.to_string(), claim);
            true
        }
    }
}

/// Remove the reply sink for `channel_id` only if `turn_id` still owns it.
///
/// A turn's completion must not remove a sink a successor turn (a reconnect, or a concurrent
/// same-session connection) has since installed — `turn_id` is a per-turn `evt_<uuid>`, so matching
/// it identifies *this* turn's own sink and nothing else. The unconditional `remove` this replaces
/// was the F5-of-round-3 residual: either completion dropped whichever sink was there.
fn remove_reply_sink_if_owner(registry: &AcpReplyRegistry, channel_id: &str, turn_id: &str) {
    let mut reg = registry.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(sink) = reg
        .get_mut(channel_id)
        .filter(|sink| sink.turn_id.as_deref() == Some(turn_id))
    {
        sink.turn_id = None;
        sink.tx = None;
    }
}

/// Registry of open MCP-over-ACP tunnels: `(channel_id, server_id)` → `TunnelHandle`.
///
/// The gateway inserts a handle once it has `mcp/connect`ed to a session's declared `type:acp`
/// server; the facade's capability source looks one up to route a tool call to the right server (T5.3). Keyed
/// by the compound `(channel_id, server_id)` (P1) so one session can carry several `type:acp`
/// servers without collision. Same `std::sync::Mutex` rationale as `AcpReplyRegistry`.
///
/// Teardown removes only the entries THIS connection owns — it matches on `owner`, not on the
/// channel. Removing every `(channel_id, *)` would delete a successor's live entry, because a
/// client that reconnects and resumes takes over the same `channel_id`.
///
/// **To reach a tunnel by its declared NAME, call [`resolve_by_name`].** Holding this map and
/// matching `server_name()` yourself is possible and is the wrong thing: which entry wins when a
/// name appears twice is decided by rank, that rank is private, and the eviction keeping names
/// unique lives beside `resolve_by_name` rather than beside you. Two callers previously did their
/// own matching, by two different rules, and neither noticed.
pub type AcpTunnelRegistry = Arc<std::sync::Mutex<HashMap<(String, String), TunnelHandle>>>;

pub fn new_tunnel_registry() -> AcpTunnelRegistry {
    Arc::new(std::sync::Mutex::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// JSON-RPC types (minimal subset for ACP)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    method: String,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

#[derive(Debug, Serialize)]
struct JsonRpcNotification {
    jsonrpc: &'static str,
    method: String,
    params: Value,
}

/// A SERVER-INITIATED JSON-RPC request (the agent→client REQUEST direction, T1). The base
/// only ever *received* requests, so `JsonRpcRequest` is deserialize-only; this is the
/// outbound counterpart used by `send_request`, which the MCP-over-ACP tunnel drives for
/// `mcp/connect`, `mcp/message` and `mcp/disconnect`.
#[derive(Debug, Serialize)]
struct JsonRpcRequestOut {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    params: Value,
}

// --- MCP-over-ACP tunnel frames (T4) ------------------------------------------
// The official MCP-over-ACP RFD (agentclientprotocol.com/rfds/mcp-over-acp) tunnels MCP
// over the /acp WS with three methods: mcp/connect → connectionId, then mcp/message (the
// inner MCP method/params FLATTENED into the params, correlated by the OUTER ACP id — the
// inner MCP id is not carried), and mcp/disconnect. These types are NOT in the generated
// `acp_schema` (the RFD is a proposal, not the stable v1 schema), so they are hand-rolled
// here. The extension is the MCP server and assigns `connectionId`; the gateway (agent side
// of the upstream hop) is the connector and issues connect/message/disconnect.

/// `mcp/connect` params — `acpId` matches the `id` of the client's `session/new`
/// `mcpServers` entry with `"type":"acp"`.
#[derive(Debug, Serialize)]
struct McpConnectParams {
    #[serde(rename = "acpId")]
    acp_id: String,
}

/// `mcp/connect` result — the client-assigned connection handle.
#[derive(Debug, Deserialize)]
struct McpConnectResult {
    #[serde(rename = "connectionId")]
    connection_id: String,
}

/// `mcp/message` params — the inner MCP `method`/`params` are flattened in (no inner id);
/// `connectionId` selects the tunnelled MCP connection.
#[derive(Debug, Serialize)]
struct McpMessageParams {
    #[serde(rename = "connectionId")]
    connection_id: String,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

/// `mcp/disconnect` params.
#[derive(Debug, Serialize)]
struct McpDisconnectParams {
    #[serde(rename = "connectionId")]
    connection_id: String,
}

impl JsonRpcResponse {
    fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// WebSocket upgrade handler: GET /acp
// ---------------------------------------------------------------------------

/// The sessions a connection may see and act on: every session for a single-tenant
/// principal, otherwise only those its binding owns.
#[derive(Clone)]
struct SessionScope {
    binding: Option<String>,
    store: Option<Arc<CredentialStore>>,
    attached: Option<AcpReplyRegistry>,
}

impl SessionScope {
    fn owns(&self, channel: &str) -> bool {
        match (&self.binding, &self.store) {
            (None, _) => true,
            (Some(binding), Some(store)) => {
                store.sessions.owner(channel).as_deref() == Some(binding.as_str())
            }
            (Some(_), None) => false,
        }
    }

    fn owns_session(&self, session_id: Option<&str>) -> bool {
        self.binding.is_none()
            || session_id
                .and_then(derive_channel_id)
                .is_some_and(|c| self.owns(&c))
    }

    /// Takes an unowned channel for this binding, or says why it cannot.
    fn claim_or_refusal(&self, channel: &str) -> Option<(i32, &'static str)> {
        match self.claim(channel) {
            Ok(Claim::Owned) => None,
            Ok(Claim::Foreign) => Some((-32003, FOREIGN_SESSION)),
            Ok(Claim::Full) => Some((ACP_OVERLOADED, BINDING_SESSIONS_IN_USE)),
            Err(_) => Some((-32603, OWNERSHIP_UNRECORDED)),
        }
    }

    fn claim(&self, channel: &str) -> std::io::Result<Claim> {
        let (Some(binding), Some(store)) = (&self.binding, &self.store) else {
            return Ok(if self.binding.is_none() {
                Claim::Owned
            } else {
                Claim::Foreign
            });
        };
        store.sessions.claim(channel, binding, |c| {
            self.attached.as_ref().is_some_and(|registry| {
                registry
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .contains_key(c)
            })
        })
    }
}

const FOREIGN_SESSION: &str = "Session belongs to another runtime binding";
const OWNERSHIP_UNRECORDED: &str = "Session ownership could not be recorded";
const BINDING_SESSIONS_IN_USE: &str = "Too many sessions in use for this runtime binding";

enum Resolution {
    Authorized(Principal),
    Unauthorized,
    /// No credential is configured at all: the keyless loopback mode.
    Keyless,
}

/// Who a bearer token belongs to. With a credential store every token, deployment keys
/// included, is resolved there; otherwise the static transport and control keys apply.
fn resolve_principal(acp: Option<&AcpConfig>, token: Option<&str>) -> Resolution {
    use subtle::ConstantTimeEq;
    if let Some(store) = acp.and_then(|c| c.credentials.as_ref()) {
        return token
            .and_then(|t| store.authenticate(t))
            .map_or(Resolution::Unauthorized, Resolution::Authorized);
    }
    let control = acp.and_then(|c| c.control_key.as_ref());
    if token
        .zip(control)
        .is_some_and(|(t, key)| bool::from(t.as_bytes().ct_eq(key.as_bytes())))
    {
        return Resolution::Authorized(Principal {
            binding_id: None,
            role: Role::Control,
        });
    }
    match acp.and_then(|c| c.auth_key.as_ref()) {
        Some(expected) => {
            if token.is_some_and(|t| bool::from(t.as_bytes().ct_eq(expected.as_bytes()))) {
                Resolution::Authorized(Principal {
                    binding_id: None,
                    role: Role::Transport,
                })
            } else {
                Resolution::Unauthorized
            }
        }
        None => Resolution::Keyless,
    }
}

pub async fn ws_upgrade(
    State(state): State<Arc<crate::AppState>>,
    headers: axum::http::HeaderMap,
    ws: WebSocketUpgrade,
) -> axum::response::Response {
    // Bearer key from a header-borne source only (Authorization or the WS subprotocol);
    // the legacy `?token=` query fallback was dropped in R17-F2. See `ws_bearer_token`.
    let token = ws_bearer_token(&headers);

    let principal = match resolve_principal(state.acp.as_ref(), token) {
        Resolution::Authorized(principal) => principal,
        Resolution::Unauthorized => {
            warn!("ACP WebSocket rejected: invalid or missing token");
            return StatusCode::UNAUTHORIZED.into_response();
        }
        Resolution::Keyless => {
            // Keyless loopback mode: the bearer check above is skipped, so a browser could
            // reach us cross-origin (WS handshakes bypass the same-origin policy). Reject a
            // browser-set `Origin` that isn't allowlisted; a non-browser client (no `Origin`)
            // is allowed.
            let origin = headers.get("origin").and_then(|v| v.to_str().ok());
            let allowed = state
                .acp
                .as_ref()
                .map(|c| c.allowed_origins.as_slice())
                .unwrap_or(&[]);
            if !acp_origin_ok(origin, allowed) {
                warn!(
                    "ACP WebSocket rejected: browser Origin {:?} not in OPENAB_ACP_ALLOWED_ORIGINS \
                     (keyless loopback mode)",
                    origin
                );
                return StatusCode::FORBIDDEN.into_response();
            }
            Principal {
                binding_id: None,
                role: Role::Transport,
            }
        }
    };

    // Echo the `acp.v1` subprotocol so a browser that offered it (alongside its
    // `openab.bearer.<token>` entry) completes the handshake. Clients that offer no
    // subprotocol are unaffected.
    ws.protocols([ACP_SUBPROTOCOL])
        .on_upgrade(move |socket| handle_acp_connection(state, socket, principal))
}

// ---------------------------------------------------------------------------
// ACP Connection handler
// ---------------------------------------------------------------------------

/// Route an inbound client *response* (an id-bearing frame with `result`/`error` and NO
/// `method`) to the `send_request` awaiter registered under its id. Returns `true` when the
/// frame was a response we consumed (so the caller must stop dispatching it as a request).
/// Mirrors the client-side correlation in `openab-core/src/acp/connection.rs`.
async fn route_client_response(
    pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    raw: &Value,
) -> bool {
    let has_method = raw.get("method").is_some();
    let looks_like_response = raw.get("result").is_some() || raw.get("error").is_some();
    if has_method || !looks_like_response {
        return false;
    }
    // Accept a numeric id (what we mint) or a stringified number ("1") from a spec-loose
    // client, so its responses still correlate to the pending request instead of being dropped.
    let Some(id) = raw.get("id").and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    }) else {
        return false;
    };
    if let Some(tx) = pending.lock().await.remove(&id) {
        let _ = tx.send(raw.clone());
    } else {
        // `debug!`, not `warn!`: since the tunnel cancels on expiry, a reply arriving after we
        // gave up is EXPECTED traffic from a well-behaved peer, not a client defect. Logging it at
        // warn made a correct peer look broken.
        debug!(
            id,
            "acp: client response arrived after its request was abandoned; discarding"
        );
    }
    true
}

/// Send a server-initiated JSON-RPC request to the connected ACP client and await its
/// response (the agent→client REQUEST direction, T1). Mints an id, registers a oneshot in
/// `pending`, writes the frame via the outbound channel, then awaits the correlated response
/// (resolved by `route_client_response`) with a timeout. Wired to a caller by T1.4 (the
/// core↔gateway MCP-over-ACP bridge); landed ahead of its caller as ready infrastructure.
async fn send_request(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: &AtomicU64,
    method: impl Into<String>,
    params: Value,
    timeout_secs: u64,
) -> Result<Value, String> {
    send_request_with_cancel(
        out_tx,
        pending,
        next_id,
        method,
        params,
        timeout_secs,
        "mcp/cancel",
    )
    .await
}

async fn send_request_with_cancel(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: &AtomicU64,
    method: impl Into<String>,
    params: Value,
    timeout_secs: u64,
    cancel_method: &str,
) -> Result<Value, String> {
    let id = next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    pending.lock().await.insert(id, tx);
    let frame = JsonRpcRequestOut {
        jsonrpc: "2.0",
        id,
        method: method.into(),
        params,
    };
    if out_tx.send(serde_json::to_string(&frame).unwrap()).is_err() {
        pending.lock().await.remove(&id);
        return Err("connection closed".into());
    }
    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => Err("connection closed before response".into()),
        Err(_) => {
            pending.lock().await.remove(&id);
            // Tell the peer we gave up. Dropping the pending entry only ends OUR wait: the
            // extension is still running the request and still holding whatever it holds — a tab,
            // a navigation, a script — with no way to learn that nobody is listening any more.
            // Best-effort by construction: this is a notification, so there is no reply to await,
            // and a peer that has already gone away simply never reads it.
            let cancel = JsonRpcNotification {
                jsonrpc: "2.0",
                method: cancel_method.to_string(),
                params: json!({ "requestId": id }),
            };
            let _ = out_tx.send(serde_json::to_string(&cancel).unwrap());
            Err("request timed out".into())
        }
    }
}

/// Relay an inner agent's ACP permission request to the outer ACP WebSocket
/// client when that session opted in with
/// `_meta["dev.openab/permissionPolicy"] = "relay"`.
///
/// `Ok(None)` preserves the historical auto-approve policy. `Err` means relay
/// was requested but no usable client path or decision remained, so callers
/// must fail closed rather than falling back to approval.
pub fn permission_relay_required(
    registry: &AcpReplyRegistry,
    channel_id: &str,
) -> Result<bool, String> {
    let reg = registry.lock().unwrap_or_else(|e| e.into_inner());
    let sink = reg
        .get(channel_id)
        .ok_or_else(|| "ACP session output sink is unavailable".to_string())?;
    Ok(sink.permission_relay.is_some())
}

/// A client connection that drops (a backend rollout moving the tunnel) leaves the agent's turn
/// running while the client reattaches with `session/resume`. A permission request in that gap
/// waits for the reattached sink instead of cancelling the tool call: the agent cannot ask twice.
pub async fn request_permission(
    registry: &AcpReplyRegistry,
    channel_id: &str,
    relay_required: bool,
    params: Value,
) -> Result<Option<Value>, String> {
    if !relay_required {
        return Ok(None);
    }
    // The grace window opens when the connection is lost, not when the request is first sent:
    // a prompt can wait on a human for minutes before a rollout drops it.
    let mut deadline = None;
    loop {
        let error = match relay_permission(registry, channel_id, params.clone()).await {
            Err(error)
                if matches!(
                    error.as_str(),
                    "ACP session output sink is unavailable"
                        | "connection closed"
                        | "connection closed before response"
                ) =>
            {
                error
            }
            result => return result,
        };
        let now = tokio::time::Instant::now();
        if error == "connection closed before response" {
            // The request reached a client before that connection dropped: a new loss.
            deadline = None;
        }
        if now >= *deadline.get_or_insert(now + PERMISSION_REATTACH_GRACE) {
            return Err(error);
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

async fn relay_permission(
    registry: &AcpReplyRegistry,
    channel_id: &str,
    mut params: Value,
) -> Result<Option<Value>, String> {
    let (session_id, handle) = {
        let reg = registry.lock().unwrap_or_else(|e| e.into_inner());
        let sink = reg
            .get(channel_id)
            .ok_or_else(|| "ACP session output sink is unavailable".to_string())?;
        (sink.session_id.clone(), sink.permission_relay.clone())
    };
    let handle = handle.ok_or_else(|| {
        "ACP permission relay required at turn start but is no longer available".to_string()
    })?;

    let Some(object) = params.as_object_mut() else {
        return Err("session/request_permission params must be an object".into());
    };
    object.insert("sessionId".into(), Value::String(session_id));
    let allowed_options: std::collections::HashSet<String> = object
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|option| option.get("optionId").and_then(Value::as_str))
        .map(str::to_string)
        .collect();
    let frame = send_request_with_cancel(
        &handle.out_tx,
        &handle.pending,
        &handle.next_id,
        "session/request_permission",
        params,
        PERMISSION_RELAY_TIMEOUT_SECS,
        "$/cancel_request",
    )
    .await?;
    let result = frame_result(frame)?;
    serde_json::from_value::<crate::adapters::acp_schema::RequestPermissionResponse>(
        result.clone(),
    )
    .map_err(|error| format!("malformed session/request_permission response: {error}"))?;
    if let Some(option_id) = result
        .get("outcome")
        .filter(|outcome| outcome.get("outcome").and_then(Value::as_str) == Some("selected"))
        .and_then(|outcome| outcome.get("optionId"))
        .and_then(Value::as_str)
    {
        if !allowed_options.contains(option_id) {
            return Err(format!(
                "session/request_permission selected unknown option {option_id}"
            ));
        }
    }
    Ok(Some(result))
}

/// Extract the `result` from a JSON-RPC response frame, mapping an `error` member to `Err`.
/// `send_request` yields the whole response frame; the tunnel helpers want just the payload.
fn frame_result(frame: Value) -> Result<Value, String> {
    if let Some(err) = frame.get("error") {
        return Err(format!("remote error: {err}"));
    }
    Ok(frame.get("result").cloned().unwrap_or(Value::Null))
}

/// `mcp/connect` (T4): open a tunnelled MCP connection to the client-provided (`"type":"acp"`)
/// MCP server identified by `acp_id`; returns the client-assigned `connectionId`.
async fn mcp_connect(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: &AtomicU64,
    acp_id: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    let params = serde_json::to_value(McpConnectParams {
        acp_id: acp_id.to_string(),
    })
    .unwrap();
    let frame = send_request(
        out_tx,
        pending,
        next_id,
        "mcp/connect",
        params,
        timeout_secs,
    )
    .await?;
    let result: McpConnectResult = serde_json::from_value(frame_result(frame)?)
        .map_err(|e| format!("mcp/connect: malformed result: {e}"))?;
    Ok(result.connection_id)
}

/// `mcp/message` REQUEST (T4): tunnel an inner MCP request over `connection_id`; returns the
/// inner MCP result payload (the outer ACP id does the correlation; the inner MCP id is not
/// carried on the wire).
async fn mcp_message_request(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: &AtomicU64,
    connection_id: &str,
    method: &str,
    params: Option<Value>,
    timeout_secs: u64,
) -> Result<Value, String> {
    let msg = serde_json::to_value(McpMessageParams {
        connection_id: connection_id.to_string(),
        method: method.to_string(),
        params,
    })
    .unwrap();
    let frame = send_request(out_tx, pending, next_id, "mcp/message", msg, timeout_secs).await?;
    frame_result(frame)
}

/// `mcp/disconnect` (T4): close a tunnelled MCP connection.
async fn mcp_disconnect(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: &AtomicU64,
    connection_id: &str,
    timeout_secs: u64,
) -> Result<(), String> {
    let params = serde_json::to_value(McpDisconnectParams {
        connection_id: connection_id.to_string(),
    })
    .unwrap();
    send_request(
        out_tx,
        pending,
        next_id,
        "mcp/disconnect",
        params,
        timeout_secs,
    )
    .await
    .map(|_| ())
}

/// Monotonic attach ordering for last-attach-wins (ADR §6.1).
///
/// Stamped at the START of an establish, before the first round trip, because "which declaration
/// is newer" is decided by when the client asked — not by which handshake happened to finish
/// first. Those differ whenever handshake durations differ, which over a real socket is the
/// normal case: a slow older establish would otherwise complete last, evict the successor that
/// beat it, and leave the STALE tunnel installed. Registration order is not attach order.
///
/// Process-wide rather than per-connection on purpose: the racing establishes belong to
/// *different* connections (a reconnect mints a fresh `server_id` on a new socket), so a
/// per-connection sequence cannot order them, and cross-connection is precisely the failing case.
static TUNNEL_GENERATION: AtomicU64 = AtomicU64::new(0);

/// A cloneable handle to one `/acp` connection's MCP-over-ACP tunnel (T5.3). Bundles the
/// per-connection outbound channel + pending-request map + id counter + the `connectionId`
/// from `mcp/connect`, so a holder can issue `mcp/message` requests to that browser and await
/// the result. Built by the gateway once the tunnel is open and (next) registered under the
/// session's `channel_id` in a shared registry, so the facade's capability source can route a tool call
/// to the right browser. This was written as D5-agnostic, when a per-session MCP server and a
/// shared core server were both live options; only the shared facade exists now, and it uses
/// this same handle.
#[derive(Clone)]
pub struct TunnelHandle {
    out_tx: mpsc::UnboundedSender<String>,
    pending: Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: Arc<AtomicU64>,
    connection_id: String,
    /// The `name` the client declared for this server (e.g. `"browser"`). Stable across
    /// reconnects, unlike the `id` the registry keys by — the reference client mints that as a
    /// fresh UUID per connection. Tool prefixes (`browser.click`) and the §6.4 trust allowlist are
    /// both keyed by this name, so it must survive registration to be routable (ADR §6.1).
    server_name: String,
    /// The `acp_conn_*` id of the WebSocket connection this tunnel belongs to.
    ///
    /// The registry key is `(channel_id, server_id)` and a reconnecting client mints a fresh
    /// `server_id`, so a key is not a stable identity — and even the channel is reused across
    /// connections by `session/resume`. Teardown therefore matches on this owner rather than on
    /// the key, so a late cleanup cannot remove a handle installed by a different connection.
    owner: String,
    /// Age of the CONNECTION that installed this tunnel, from [`TUNNEL_GENERATION`], stamped
    /// when that connection was accepted.
    ///
    /// A resume sweep is authorised by connection age, not by when the resume happened to be
    /// processed: an older connection's late resume must not retire a tunnel installed by a newer
    /// connection, and "which resume ran first" cannot express that. Stamping the resume itself
    /// measures the wrong thing — the late resume takes the HIGHER number precisely because it ran
    /// last, so it would still outrank the newer connection it must not touch.
    connection_generation: u64,
    /// Attach ordering from [`TUNNEL_GENERATION`], stamped when this establish STARTED.
    ///
    /// Eviction compares generations instead of trusting arrival order, so a slow establish that
    /// finishes after a newer one cannot evict its own successor.
    generation: u64,
}

impl TunnelHandle {
    /// The client-declared server name for this tunnel (see the field docs for why the declared
    /// name and the registry key are deliberately different things).
    ///
    /// Exposed for reporting, not for routing. Selecting a tunnel by comparing this against a
    /// wanted name is what [`resolve_by_name`] exists to do — it also knows which entry wins if a
    /// name ever appears twice, which this accessor cannot tell you.
    pub fn server_name(&self) -> &str {
        &self.server_name
    }

    /// Tunnel an inner MCP request (`tools/list`, `tools/call`, …) to the extension over this
    /// connection and return the inner MCP result payload.
    pub async fn mcp_message(
        &self,
        method: &str,
        params: Option<Value>,
        timeout_secs: u64,
    ) -> Result<Value, String> {
        mcp_message_request(
            &self.out_tx,
            &self.pending,
            &self.next_id,
            &self.connection_id,
            method,
            params,
            timeout_secs,
        )
        .await
    }

    /// Close this tunnel (`mcp/disconnect`).
    pub async fn disconnect(&self, timeout_secs: u64) -> Result<(), String> {
        mcp_disconnect(
            &self.out_tx,
            &self.pending,
            &self.next_id,
            &self.connection_id,
            timeout_secs,
        )
        .await
    }
}

/// MCP protocol version the gateway speaks to a tunnelled client MCP server.
const INNER_MCP_PROTOCOL_VERSION: &str = "2025-06-18";

/// Revisions this gateway ACCEPTS in an inner `initialize` result (R5, D-2026-07-30-10).
///
/// Negotiation, not equality. MCP says a server that does not support the requested revision
/// answers with one it does support, so strict equality against
/// [`INNER_MCP_PROTOCOL_VERSION`] rejected a peer for behaving exactly as specified. That matters
/// here because the point of client-declared `type:acp` servers is to work with peers we did not
/// write.
///
/// WHY THIS SET IS SAFE — re-check this before adding a fifth inner method.
///
/// The whole inner surface this gateway drives is four methods, and their shapes are compatible
/// across all three revisions:
///
///   - `initialize` and `notifications/initialized` — `inner_mcp_handshake`, below;
///   - `tools/list` — `src/browser_source.rs:200`;
///   - `tools/call` — `src/browser_source.rs:351`.
///
/// Verified against the tree: those are the only methods reaching an inner server.
///
/// RE-CHECK THIS SET when any of three things changes, not just the first:
///
///   - a fifth inner method is added;
///   - the transport changes;
///   - the framing changes.
///
/// Compatibility is a property of what we actually send and how we send it, not of the revisions
/// in the abstract, so a transport or framing change can invalidate the set while the method list
/// stays identical. A bare list of version strings with no stated reason is how this becomes
/// silently wrong later.
const SUPPORTED_INNER_MCP_PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// Perform the inner MCP handshake on a freshly connected tunnel.
///
/// MCP requires `initialize` → response → `notifications/initialized` before any other request. We
/// were sending `tools/list` and `tools/call` straight after `mcp/connect`, which happens to work
/// against today's single extension because it is lenient. That is not a defence: the deliverable
/// is *generic* client-declared MCP servers, and a standards-compliant server is entitled to
/// reject — or simply not answer — anything that arrives before it has been initialized.
///
/// Failure here fails the establish, so a server that cannot complete the handshake never reaches
/// the registry: better no tunnel than one whose first real call is rejected for a reason the
/// operator cannot see.
async fn inner_mcp_handshake(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: &AtomicU64,
    connection_id: &str,
    timeout_secs: u64,
) -> Result<(), String> {
    // Reuse `mcp_message_request` rather than re-assembling the frame: sending an inner MCP
    // request and unwrapping its result has exactly one implementation, so the `protocolVersion`
    // check below only has to exist in one place.
    let init = mcp_message_request(
        out_tx,
        pending,
        next_id,
        connection_id,
        "initialize",
        Some(json!({
            "protocolVersion": INNER_MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "openab-gateway", "version": env!("CARGO_PKG_VERSION") }
        })),
        timeout_secs,
    )
    .await?;

    // A reply proves the server answered, not that it agreed. A server answering a version we do
    // not speak would be registered here and then fail on its first real `tools/call`, for a
    // reason nothing in the log explains — the exact opaque failure this handshake exists to
    // prevent. Refuse the establish instead, and name both versions so the mismatch is readable.
    match init.get("protocolVersion").and_then(Value::as_str) {
        Some(v) if SUPPORTED_INNER_MCP_PROTOCOL_VERSIONS.contains(&v) => {}
        Some(other) => {
            return Err(format!(
                "inner MCP server answered protocolVersion {other}, which this gateway does not \
                 speak (requested {INNER_MCP_PROTOCOL_VERSION}, accepts {})",
                SUPPORTED_INNER_MCP_PROTOCOL_VERSIONS.join(", ")
            ));
        }
        None => {
            return Err(
                "inner MCP `initialize` result carried no `protocolVersion` string".to_string(),
            );
        }
    }

    // `notifications/initialized` is a notification in both directions: an inner MCP notification,
    // carried by an outer frame with no `id`, so nothing is awaited and no reply is owed.
    let initialized = serde_json::to_value(McpMessageParams {
        connection_id: connection_id.to_string(),
        method: "notifications/initialized".to_string(),
        params: None,
    })
    .map_err(|e| e.to_string())?;
    let notification = json!({
        "jsonrpc": "2.0",
        "method": "mcp/message",
        "params": initialized,
    });
    out_tx
        .send(notification.to_string())
        .map_err(|_| "connection closed before notifications/initialized".to_string())?;
    Ok(())
}

/// Open the MCP-over-ACP tunnel to a session's declared `"type":"acp"` server and register a
/// `TunnelHandle` under the session's `channel_id` so the facade's capability source can reach it (T5.3).
/// MUST run in a spawned task, never inline in the connection read loop: `mcp_connect` awaits
/// the client's response, which only that same read loop can deliver — awaiting it inline
/// would deadlock.
#[allow(clippy::too_many_arguments)]
async fn establish_and_register_tunnel(
    out_tx: mpsc::UnboundedSender<String>,
    pending: Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: Arc<AtomicU64>,
    acp_id: String,
    acp_name: String,
    channel_id: String,
    registry: AcpTunnelRegistry,
    timeout_secs: u64,
    owner: String,
    connection_generation: u64,
    connection_closed: Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    // Observability: reaching here means the client DID declare a "type":"acp" server, so this
    // line in the log answers "did the browser extension advertise itself?" for a live session.
    info!(acp_id = %acp_id, acp_name = %acp_name, channel = %redact_id(&channel_id), "ACP: opening MCP-over-ACP tunnel");
    // Stamp BEFORE the first round trip: this establish's place in attach order is fixed by when
    // the client declared the server, not by how long its handshake takes. See `TUNNEL_GENERATION`.
    let generation = TUNNEL_GENERATION.fetch_add(1, Ordering::Relaxed);
    let connection_id = mcp_connect(&out_tx, &pending, &next_id, &acp_id, timeout_secs).await?;
    // MCP lifecycle before the tunnel is usable — see `inner_mcp_handshake`.
    //
    // On failure the client is still holding an open connection it opened for us, and we are about
    // to return without registering a handle for it. Every other cleanup path in this file goes
    // through the registry (`reg.remove(..)` then `handle.disconnect(..)`), so a connection that
    // never got registered has none at all — it would leak for the life of the process, once per
    // attach, and a handshake timeout against a slow server is enough to trigger it. Same
    // obligation the eviction path documents: the client believes the connection is open, so it is
    // owed an `mcp/disconnect`.
    //
    // Best-effort and off the failure path, matching the eviction disconnect: a client that just
    // failed a handshake may be in no state to answer, and waiting on it would delay the error the
    // caller needs to log.
    if let Err(e) =
        inner_mcp_handshake(&out_tx, &pending, &next_id, &connection_id, timeout_secs).await
    {
        let (tx, pend, nid, cid) = (
            out_tx.clone(),
            pending.clone(),
            next_id.clone(),
            connection_id.clone(),
        );
        tokio::spawn(async move {
            if let Err(e) = mcp_disconnect(&tx, &pend, &nid, &cid, 5).await {
                // `warn!`, not `debug!`: reaching here means the connection we opened is now
                // leaked for the life of the process — it never entered the registry, so nothing
                // else will ever close it. Logging the cleanup failure more quietly than the
                // handshake failure it cleans up after would hide the worse of the two.
                warn!(
                    error = %e, connection = %redact_id(&cid),
                    "ACP: mcp/disconnect after a failed handshake did not complete — that \
                     connection is now unreclaimable"
                );
            }
        });
        return Err(e);
    }
    let handle = TunnelHandle {
        out_tx,
        pending,
        next_id,
        connection_id,
        server_name: acp_name.clone(),
        owner: owner.clone(),
        generation,
        connection_generation,
    };
    // `Superseded` carries the handle back out of the lock: a losing establish still owes its
    // client an `mcp/disconnect`, and `disconnect` is async while this is a std mutex.
    enum Registered {
        Done(Vec<TunnelHandle>),
        Superseded(TunnelHandle),
    }
    let outcome = {
        let mut reg = registry.lock().unwrap_or_else(|e| e.into_inner());
        // Last-attach-wins (ADR §6.1). The client mints a fresh `id` on every connection, so a
        // reconnect would otherwise leave the dead tunnel registered beside the live one under
        // the same declared name. Answering "ambiguous — pass a server_id" there would wedge the
        // client out of its own tools on every reconnect, so the newest attach evicts its stale
        // same-name predecessors instead — which is also what bounds registry growth.
        //
        // Take the stale handles OUT rather than dropping them: the client still believes those
        // connections are open, so each one is owed an `mcp/disconnect` (review R7). They are
        // collected here and disconnected after the lock is released — `disconnect` is async and
        // this is a std mutex, so awaiting under it is not an option.
        //
        // Deliberately NOT scoped to the attaching connection. A reconnecting client arrives on a
        // NEW socket with a fresh `server_id`, so its predecessor's handle is owned by the old
        // connection — restricting eviction to one owner would leave that dead tunnel registered
        // beside the live one under the same declared name, which is the ambiguity
        // last-attach-wins exists to prevent (ADR §6.1). Teardown is owner-scoped; eviction is
        // not, and they are different questions.
        let own_key = (channel_id.clone(), acp_id.clone());
        let same_name = |c: &String, id: &String, h: &TunnelHandle| {
            c == &channel_id && h.server_name == acp_name && id != &acp_id
        };
        // Ordering is by generation, not by who reached this lock first. A slow establish that
        // started EARLIER but finished later must not evict the newer tunnel that beat it here:
        // it lost the race the client actually cares about, so it stands down and closes its own
        // connection instead of installing a stale handle over a live one.
        //
        // OUR OWN KEY is checked separately and must be, because `same_name` excludes it: a client
        // is free to reuse the same `server_id` across a reconnect — nothing in the protocol
        // requires a fresh one, and a stable id is the more natural implementation for a generic
        // peer. When it does, both establishes land on this one key, `same_name` never sees the
        // newer entry, and the older arrival would `insert` straight over a live handle. Ordering
        // has to hold per key, not just per declared name.
        // The closed flag is read HERE, under the registry lock, because that is the only place it
        // can be decisive. `abort()` cannot close this race: it takes effect at an await point and
        // there is none between the handshake completing and the insert below, so on a
        // multi-thread runtime this section runs concurrently with teardown's `retain`. The flag is
        // set BEFORE that retain, so whichever takes the lock first the outcome is right — insert
        // first and the retain removes it; retain first and we never insert at all. Without it a
        // late establish drops a handle owned by a dead connection into an empty slot, where
        // nothing will ever remove it.
        // Ordering is LEXICOGRAPHIC on (connection age, attach order), and it has to be both.
        //
        // Attach order alone repeats the mistake the sweep already had to fix: it is stamped when an
        // establish starts, so an older connection's LATE resume spawns an establish with a HIGHER
        // number — precisely because it ran later — and then outranks the newer connection whose
        // tunnel it must not take. Connection age is what says which declaration set is current.
        //
        // Attach order is still needed as the tiebreak: within ONE connection the ages are equal, and
        // there last-attach-wins is exactly right.
        let rank = (connection_generation, generation);
        let superseded = connection_closed.load(std::sync::atomic::Ordering::Acquire)
            || reg
                .get(&own_key)
                .is_some_and(|h| (h.connection_generation, h.generation) > rank)
            || reg.iter().any(|((c, id), h)| {
                same_name(c, id, h) && (h.connection_generation, h.generation) > rank
            });
        if superseded {
            Registered::Superseded(handle)
        } else {
            // No rank comparison here, deliberately. Everything ranking ABOVE this establish has
            // already returned through `superseded`, and ranks are unique, so every surviving
            // same-name entry necessarily ranks below — the comparison would be true every time.
            //
            // It was written out rather than left in place because a condition that looks like a
            // check, is in fact always true, and becomes WRONG if it ever stops matching the
            // comparison above is worse than no condition at all. Held as lexicographic it was
            // redundant; changed on its own to attach-order it silently stopped evicting an incumbent
            // that was older by connection but later by attach, leaving two tunnels under one
            // declared name. Both readings of it misled me inside two hours.
            //
            // INVARIANT: the eviction set is "same declared name, not me". Anything that should have
            // won is filtered out earlier by `superseded`; if that check is ever weakened, this is
            // where the damage shows up, so change the two together.
            let stale: Vec<(String, String)> = reg
                .iter()
                .filter(|((c, id), h)| same_name(c, id, h))
                .map(|(k, _)| k.clone())
                .collect();
            let mut replaced: Vec<TunnelHandle> =
                stale.iter().filter_map(|k| reg.remove(k)).collect();
            // Whatever this insert displaces is owed a disconnect too. Discarding the return value
            // leaked the previous holder of this exact key: it left the registry, so no cleanup
            // path could reach it, while its client still believed the connection was open.
            replaced.extend(reg.insert(own_key, handle));
            Registered::Done(replaced)
        }
    };
    let replaced = match outcome {
        Registered::Done(replaced) => replaced,
        Registered::Superseded(handle) => {
            info!(
                channel = %redact_id(&channel_id), server_name = %acp_name, generation,
                "ACP: a newer attach already holds this name — standing down without registering"
            );
            // Same obligation as eviction: the client opened this connection for us and we are not
            // going to use it, so it is owed an `mcp/disconnect`. Best-effort, off the attach path.
            tokio::spawn(async move {
                if let Err(e) = handle.disconnect(5).await {
                    debug!(error = %e, "ACP: mcp/disconnect for a superseded establish did not complete");
                }
            });
            return Ok(());
        }
    };
    if !replaced.is_empty() {
        info!(
            channel = %redact_id(&channel_id), server_name = %acp_name, replaced = replaced.len(),
            "ACP: last-attach-wins — replaced stale tunnel(s)"
        );
        // Best-effort and off the attach path: a replaced connection may already be dead, and
        // waiting on its response would stall the tunnel that just came up for no benefit.
        tokio::spawn(async move {
            for handle in replaced {
                if let Err(e) = handle.disconnect(5).await {
                    debug!(error = %e, "ACP: mcp/disconnect for a replaced tunnel did not complete");
                }
            }
        });
    }
    info!(channel = %redact_id(&channel_id), server_id = %acp_id, server_name = %acp_name, "ACP: tunnel registered — client MCP server attached");
    Ok(())
}

/// Open + register a tunnel for **every** `type:acp` server the session's client declared.
///
/// The old "first declared server only" limit came from the registry being keyed by `channel_id`
/// alone, where a second server would overwrite the first and orphan its open tunnel. The compound
/// `(channel_id, server_id)` key removed that collision, so all declared servers are established
/// now; a re-declared *name* is resolved last-attach-wins inside `establish_and_register_tunnel`
/// (ADR §6.1). Spawned (not awaited inline) because that function awaits the client's
/// `mcp/connect` response, which only the read loop delivers — awaiting inline would deadlock.
#[allow(clippy::too_many_arguments)]
fn spawn_acp_tunnels(
    servers: Vec<AcpMcpServer>,
    channel_id: String,
    registry: AcpTunnelRegistry,
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: &Arc<AtomicU64>,
    establish_tasks: &mut Vec<tokio::task::JoinHandle<()>>,
    owner: &str,
    connection_generation: u64,
    connection_closed: &Arc<std::sync::atomic::AtomicBool>,
) {
    // Drop finished handles first so a long-lived connection does not accumulate them, then bound
    // what is still running. Over the cap the declaration is dropped with a warning rather than
    // refusing the whole request: the session itself is valid and its other servers still attach.
    establish_tasks.retain(|h| !h.is_finished());
    for srv in servers {
        let out_tx = out_tx.clone();
        let pending = pending.clone();
        let next_id = next_id.clone();
        let registry = registry.clone();
        let channel_id = channel_id.clone();
        let owner = owner.to_string();
        let connection_closed = connection_closed.clone();
        if establish_tasks.len() >= MAX_INFLIGHT_ESTABLISHES {
            warn!(
                max = MAX_INFLIGHT_ESTABLISHES,
                "ACP: too many tunnels establishing on this connection — dropping a declaration"
            );
            break;
        }
        establish_tasks.push(tokio::spawn(async move {
            if let Err(e) = establish_and_register_tunnel(
                out_tx,
                pending,
                next_id,
                srv.id,
                srv.name,
                channel_id,
                registry,
                30,
                owner,
                connection_generation,
                connection_closed,
            )
            .await
            {
                warn!(error = %e, "ACP: failed to open MCP-over-ACP tunnel");
            }
        }));
    }
}

async fn read_runtime_snapshot(state: &crate::AppState, channel: &str) -> Option<Value> {
    let read = state.acp_session_snapshot.as_ref()?;
    let mut provider = read(channel.to_string()).await;
    state
        .acp_session_automation
        .observe_provider_epoch(channel, provider["epoch"].as_str());
    provider["gateway"] = state.acp_session_operations.snapshot(channel);
    if provider["state"] == "active"
        && provider["operation"] == "none"
        && provider["gateway"]["cancelling"] != true
    {
        state.acp_session_requests.open(channel);
    }
    if matches!(provider["state"].as_str(), Some("interrupted" | "dormant"))
        && !state.acp_session_requests.pending(channel).is_empty()
    {
        state.acp_session_requests.cancel_pending(channel);
    }
    provider["automation"] = state.acp_session_automation.snapshot(channel);
    provider["requests"] = json!(state.acp_session_requests.pending(channel));
    let pending = state.acp_session_operations.pending(channel)
        || state.acp_reply_registry.as_ref().is_some_and(|registry| {
            registry
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(channel)
                .is_some_and(|sink| sink.turn_id.is_some())
        });
    Some(state.acp_session_states.project(channel, provider, pending))
}

/// Publish lifecycle before native content: even a sub-tick autonomous turn must
/// open its transcript before its first token. Native idle cannot close the
/// transcript while the gateway is still delivering the final response.
pub async fn publish_runtime_snapshot(state: &crate::AppState, channel: &str) {
    if !state.acp_session_automation.enabled(channel) {
        return;
    }
    let Some(snapshot) = read_runtime_snapshot(state, channel).await else {
        return;
    };
    let route = state.acp_reply_registry.as_ref().and_then(|registry| {
        registry
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(channel)
            .map(|sink| {
                (
                    sink.session_id.clone(),
                    sink.out_tx.clone(),
                    sink.owner.clone(),
                )
            })
    });
    if let Some((session, output, owner)) = route {
        if !state
            .acp_session_states
            .should_publish(channel, &snapshot, &owner)
        {
            return;
        }
        let _ = output.send(json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":session,"update":{"sessionUpdate":"runtime_state","snapshot":snapshot}}}).to_string());
    }
}

async fn handle_acp_connection(
    state: Arc<crate::AppState>,
    socket: WebSocket,
    principal: Principal,
) {
    let runtime_control = principal.role == Role::Control;
    let credentials = state.acp.as_ref().and_then(|c| c.credentials.clone());
    let scope = SessionScope {
        binding: principal.session_scope().map(str::to_owned),
        store: credentials.clone(),
        attached: state.acp_reply_registry.clone(),
    };
    let mut revocations = credentials
        .as_ref()
        .filter(|_| principal.binding_id.is_some())
        .map(|store| store.subscribe());
    // A revoke that landed between the handshake and the subscription above.
    let revoked_before_accept = principal
        .binding_id
        .as_deref()
        .zip(credentials.as_ref())
        .is_some_and(|(id, store)| !store.contains(id));
    let (mut ws_tx, mut ws_rx) = socket.split();
    let connection_id = format!("acp_conn_{}", Uuid::new_v4());
    // Age of this connection, from the same counter that orders attaches. A resume's authority to
    // retire someone else's tunnel is decided by which CONNECTION is newer, so it has to be stamped
    // here — once, at accept — rather than per request.
    let connection_generation = TUNNEL_GENERATION.fetch_add(1, Ordering::Relaxed);
    // Set once, at teardown, and read by in-flight establishes under the registry lock. See the
    // check in `establish_and_register_tunnel` for why `abort()` cannot do this job.
    let connection_closed = Arc::new(std::sync::atomic::AtomicBool::new(false));

    info!(connection = %connection_id, "ACP client connected");
    ACP_ACTIVE_CONNECTIONS.fetch_add(1, Ordering::Relaxed);

    // Frame tracing (OPENAB_ACP_TRACE) — read once per connection.
    let trace = acp_trace_enabled();
    // http-mcpServers passthrough gate (OPENAB_ACP_MCP_SERVERS) — read once per connection.
    let mcp_enabled = acp_mcp_servers_enabled();

    // Session state for this connection
    let sessions: Arc<tokio::sync::Mutex<HashMap<String, AcpSession>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    // Pending server-initiated requests (T1): id → oneshot for the client's response. The
    // base had only client→server requests + server→client notifications; the MCP-over-ACP
    // tunnel adds the server→client REQUEST direction, correlated through this map by
    // `route_client_response` (inbound) and `send_request` (outbound, wired in T1.4).
    let pending_requests: Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    // Monotonic id source for server-initiated requests (mcp/connect, mcp/message).
    let next_req_id = Arc::new(AtomicU64::new(1));
    let mut initialized = false;
    let mut terminals = runtime_terminal::Terminals::new();

    // Track spawned prompt tasks so we can abort on disconnect
    let mut prompt_tasks: Vec<tokio::task::JoinHandle<()>> = Vec::new();
    // Tunnel establishes get their own set. Sharing one with prompts meant a pending `mcp/connect`
    // consumed prompt budget, and the client saw an overload error for work it never requested.
    let mut establish_tasks: Vec<tokio::task::JoinHandle<()>> = Vec::new();

    // Channel for sending messages back to the client
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

    // Runtime-owned snapshots are pushed independently of text/tool output.
    // This also reports permission waits when the model has emitted no new tokens.
    let snapshots_enabled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let snapshot_task = {
        let enabled = snapshots_enabled.clone();
        let state = state.clone();
        let sessions = sessions.clone();
        let out_tx = out_tx.clone();
        let connection_id = connection_id.clone();
        tokio::spawn(async move {
            let mut sent: HashMap<String, Value> = HashMap::new();
            let mut tick = tokio::time::interval(std::time::Duration::from_millis(250));
            loop {
                tick.tick().await;
                if !enabled.load(Ordering::Acquire) {
                    continue;
                }
                let channels: Vec<_> = sessions
                    .lock()
                    .await
                    .iter()
                    .map(|(id, session)| (id.clone(), session.channel_id.clone()))
                    .collect();
                for (id, channel) in channels {
                    // A session another connection has since resumed or prompted reports there.
                    // Pushing it here as well repeated every snapshot once per connection that
                    // had ever held the session.
                    let foreign = state.acp_reply_registry.as_ref().is_some_and(|registry| {
                        registry
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .get(&channel)
                            .is_some_and(|sink| sink.owner != connection_id)
                    });
                    if foreign {
                        continue;
                    }
                    if let Some(snapshot) = read_runtime_snapshot(&state, &channel).await {
                        if sent.get(&id) == Some(&snapshot) {
                            continue;
                        }
                        sent.insert(id.clone(), snapshot.clone());
                        let notification = json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":id,"update":{"sessionUpdate":"runtime_state","snapshot":snapshot}}});
                        if out_tx.send(notification.to_string()).is_err() {
                            return;
                        }
                    }
                }
            }
        })
    };

    // Forward outbound messages to WebSocket. Single choke point for every outbound
    // frame, so trace here rather than at each send site.
    let send_conn = connection_id.clone();
    let (close_tx, mut close_rx) = oneshot::channel::<()>();
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = out_rx.recv() => {
                    let Some(msg) = msg else { break };
                    if trace {
                        debug!(connection = %send_conn, dir = "out", frame = %trace_frame(&msg), "ACP frame");
                    }
                    if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                close = &mut close_rx => {
                    if close.is_ok() {
                        let _ = ws_tx
                            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                                code: BINDING_REVOKED_CLOSE_CODE,
                                reason: "binding revoked".into(),
                            })))
                            .await;
                    }
                    break;
                }
            }
        }
    });

    // Process incoming messages
    let mut revoked = revoked_before_accept;
    while !revoked {
        let next = match credentials.as_ref() {
            Some(store) => tokio::select! {
                msg = ws_rx.next() => msg,
                () = store.revoked(principal.binding_id.as_deref(), &mut revocations) => {
                    revoked = true;
                    break;
                }
            },
            None => ws_rx.next().await,
        };
        let Some(Ok(msg)) = next else { break };
        let Message::Text(text) = msg else {
            continue;
        };

        // Bound inbound frame size before parsing. An oversized frame can't be parsed,
        // so we can't tell request from notification or recover its id — do NOT fabricate
        // a JSON-RPC response (which would violate notification silence). Treat it as a
        // transport-level violation: log and close the connection.
        if text.len() > MAX_FRAME_BYTES {
            warn!(
                connection = %connection_id,
                bytes = text.len(),
                max = MAX_FRAME_BYTES,
                "ACP frame too large; closing connection"
            );
            break;
        }

        if trace {
            debug!(connection = %connection_id, dir = "in", frame = %trace_frame(&text), "ACP frame");
        }

        let raw: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                let err_resp =
                    JsonRpcResponse::error(Value::Null, -32700, format!("Parse error: {e}"));
                let _ = out_tx.send(serde_json::to_string(&err_resp).unwrap());
                continue;
            }
        };

        // JSON-RPC: a message WITHOUT an `id` member is a notification and MUST NOT
        // receive any response; a message WITH an `id` (including explicit `null`) is a
        // request. serde's `Option<Value>` collapses omitted and `null` to the same
        // `None`, so notification detection uses raw key PRESENCE on the parsed JSON.
        let is_notification = raw.get("id").is_none();

        // JSON-RPC: `id`, when present, MUST be a string, number, or null — never an
        // object, array, or boolean. Reject a wrong-typed id as an Invalid Request.
        if let Some(id) = raw.get("id") {
            if !(id.is_string() || id.is_number() || id.is_null()) {
                let err_resp = JsonRpcResponse::error(
                    Value::Null,
                    -32600,
                    "Invalid Request: id must be a string, number, or null",
                );
                let _ = out_tx.send(serde_json::to_string(&err_resp).unwrap());
                continue;
            }
        }

        // Per-kind size cap (review F2). The 8 MiB check above is the transport ceiling, and only
        // tunnel results legitimately reach it — those are client RESPONSES (no `method`), handled
        // just below. Anything carrying a `method` is a client request or notification, so hold it
        // to the pre-existing 1 MiB: otherwise the browser-result allowance doubles as a way to
        // park MAX_INFLIGHT_PROMPTS × 8 MiB of prompt text on one connection.
        if let Some(method) = oversized_for_its_kind(text.len(), &raw) {
            {
                warn!(
                    connection = %connection_id,
                    method,
                    bytes = text.len(),
                    max = MAX_NON_TUNNEL_FRAME_BYTES,
                    "ACP frame too large for its method; rejecting"
                );
                // A notification MUST NOT be answered; drop it and keep the connection.
                if !is_notification {
                    let id = raw.get("id").cloned().unwrap_or(Value::Null);
                    let err_resp = JsonRpcResponse::error(
                        id,
                        ACP_OVERLOADED,
                        format!(
                            "Frame too large: {} exceeds the {MAX_NON_TUNNEL_FRAME_BYTES}-byte limit for `{method}`",
                            text.len()
                        ),
                    );
                    let _ = out_tx.send(serde_json::to_string(&err_resp).unwrap());
                }
                continue;
            }
        }

        // A client *response* to a server-initiated request (T1): id present, no `method`,
        // carries `result`/`error`. Route it to the waiting `send_request` and stop — it is
        // neither a client request nor a notification. Gated on `!is_notification` (a
        // notification never carries an id, so it can never be a response), keeping the
        // existing notification/request handling below untouched.
        if !is_notification && route_client_response(&pending_requests, &raw).await {
            continue;
        }

        let req: JsonRpcRequest = match serde_json::from_value(raw) {
            Ok(r) => r,
            Err(e) => {
                if !is_notification {
                    let err_resp = JsonRpcResponse::error(
                        Value::Null,
                        -32600,
                        format!("Invalid Request: {e}"),
                    );
                    let _ = out_tx.send(serde_json::to_string(&err_resp).unwrap());
                }
                continue;
            }
        };

        // Validate JSON-RPC version (spec requires "2.0"). Only answer a request.
        if req.jsonrpc != "2.0" {
            if !is_notification {
                let id = req.id.clone().unwrap_or(Value::Null);
                let err_resp =
                    JsonRpcResponse::error(id, -32600, "Invalid Request: jsonrpc must be \"2.0\"");
                let _ = out_tx.send(serde_json::to_string(&err_resp).unwrap());
            }
            continue;
        }

        // Request-only methods sent as a notification (no id) cannot return their result,
        // so per JSON-RPC they get no response — and we do not execute them as
        // fire-and-forget. Only `session/cancel` is a real notification (handled below).
        if is_notification
            && matches!(
                req.method.as_str(),
                "initialize"
                    | "session/new"
                    | "session/resume"
                    | "session/prompt"
                    | "session/set_config_option"
                    | "_openab/session/config_options"
                    | "_openab/session/steer"
                    | "_openab/session/state"
                    | "_openab/runtime/state"
                    | "_openab/runtime/login"
                    | "_openab/runtime/login/cancel"
                    | "_openab/runtime/login/input"
                    | "_openab/runtime/terminal/start"
                    | "_openab/runtime/terminal/ack"
                    | "_openab/runtime/terminal/input"
                    | "_openab/runtime/terminal/resize"
                    | "_openab/runtime/terminal/close"
                    | "_openab/runtime/job"
                    | "_openab/runtime/job/cancel"
                    | "_openab/session/requests"
            )
        {
            debug!(method = %req.method, "ACP request-only method sent without id (notification) — ignored");
            continue;
        }

        // Safe: request-only arms below are only reached when `id` is present.
        let id = req.id.clone().unwrap_or(Value::Null);

        match req.method.as_str() {
            "initialize" => {
                let mut resp = handle_initialize(&req, mcp_enabled);
                if let Some(result) = resp.result.as_mut() {
                    result["agentCapabilities"]["_meta"]["dev.openab/runtimeTerminal"] =
                        json!(runtime_terminal::enabled());
                }
                if state.acp_pool_config.is_some() {
                    if let Some(result) = resp.result.as_mut() {
                        result["agentCapabilities"]["_meta"]["dev.openab/sessionConfig"] =
                            json!(true);
                    }
                }
                if state.acp_session_credentials.is_some() {
                    if let Some(result) = resp.result.as_mut() {
                        result["agentCapabilities"]["_meta"]["dev.openab/credentialRefresh"] =
                            json!(true);
                    }
                }
                if state.acp_session_snapshot.is_some() {
                    if let Some(result) = resp.result.as_mut() {
                        result["agentCapabilities"]["_meta"]["dev.openab/sessionAuthority"] =
                            json!(2);
                    }
                }
                if let (Some(result), Some(acp)) = (resp.result.as_mut(), state.acp.as_ref()) {
                    result["agentCapabilities"]["_meta"]["dev.openab/runtimeJobs"] =
                        json!(acp.runtime_jobs.names());
                }
                // Only mark the connection initialized when negotiation succeeded.
                let negotiated_ok = resp.error.is_none();
                let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                if negotiated_ok {
                    initialized = true;
                    snapshots_enabled.store(
                        req.params
                            .as_ref()
                            .and_then(|p| {
                                p.pointer("/clientCapabilities/_meta/dev.openab~1sessionSnapshots")
                            })
                            .and_then(Value::as_bool)
                            == Some(true),
                        Ordering::Release,
                    );
                }
            }
            "session/new" => {
                if !initialized {
                    let resp = JsonRpcResponse::error(id, -32002, "Not initialized");
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                // Required params per schema: { cwd, mcpServers }.
                if let Err(msg) = validate_params::<crate::adapters::acp_schema::NewSessionRequest>(
                    req.params.as_ref(),
                ) {
                    let resp = JsonRpcResponse::error(id, -32602, msg);
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                // Cap sessions per connection (deterministic overload, not unbounded).
                if sessions.lock().await.len() >= MAX_SESSIONS_PER_CONNECTION {
                    let resp = JsonRpcResponse::error(
                        id,
                        ACP_OVERLOADED,
                        format!("Too many sessions on this connection (max {MAX_SESSIONS_PER_CONNECTION})"),
                    );
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                // Bound the declaration fan-out BEFORE the session exists or any task is
                // spawned (R3-F1): an over-declaring request must cost nothing.
                let acp_mcp_servers =
                    match accept_acp_servers(parse_acp_mcp_servers(req.params.as_ref())) {
                        Ok(list) => list,
                        Err(msg) => {
                            let resp = JsonRpcResponse::error(id, ACP_OVERLOADED, msg);
                            let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                            continue;
                        }
                    };
                let permission_relay = permission_relay_requested(req.params.as_ref());
                let permission_relay_handle = permission_relay.then(|| ClientRequestHandle {
                    out_tx: out_tx.clone(),
                    pending: pending_requests.clone(),
                    next_id: next_req_id.clone(),
                });
                let (http_mcp_servers, session_meta) = if mcp_enabled {
                    (
                        parse_http_mcp_servers(req.params.as_ref()),
                        parse_session_meta(req.params.as_ref()),
                    )
                } else {
                    (Vec::new(), None)
                };
                let (resp, channel_id) =
                    handle_session_new(&sessions, id.clone(), http_mcp_servers, session_meta).await;
                let session_id = channel_id.replacen("acp_", "sess_", 1);
                if let Some((code, message)) = scope.claim_or_refusal(&channel_id) {
                    sessions.lock().await.remove(&session_id);
                    let resp = JsonRpcResponse::error(id, code, message);
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                if let Some(session) = sessions.lock().await.get_mut(&session_id) {
                    session.permission_relay = permission_relay_handle.clone();
                }
                if let Some(ref registry) = state.acp_reply_registry {
                    install_reply_sink(
                        registry,
                        &channel_id,
                        ReplySink {
                            turn_id: None,
                            tx: None,
                            session_id,
                            out_tx: out_tx.clone(),
                            owner: connection_id.clone(),
                            generation: connection_generation,
                            permission_relay: permission_relay_handle,
                        },
                    );
                }
                let _ = out_tx.send(serde_json::to_string(&resp).unwrap());

                // If the client declared "type":"acp" MCP servers, open + register a tunnel to
                // each so the facade's capability source can reach this browser. SPAWNED, not awaited
                // inline: `establish_and_register_tunnel` awaits `mcp/connect`, whose response
                // only THIS read loop delivers — awaiting inline would deadlock.
                if let Some(registry) = state.acp_tunnel_registry.clone() {
                    spawn_acp_tunnels(
                        acp_mcp_servers,
                        channel_id.clone(),
                        registry,
                        &out_tx,
                        &pending_requests,
                        &next_req_id,
                        &mut establish_tasks,
                        &connection_id,
                        connection_generation,
                        &connection_closed,
                    );
                }
            }
            "session/resume" => {
                if !initialized {
                    let resp = JsonRpcResponse::error(id, -32002, "Not initialized");
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                // Required params per schema: { sessionId, cwd, mcpServers? }. The
                // sessionId's `sess_<uuid>` shape is checked further in the handler.
                if let Err(msg) = validate_params::<crate::adapters::acp_schema::ResumeSessionRequest>(
                    req.params.as_ref(),
                ) {
                    let resp = JsonRpcResponse::error(id, -32602, msg);
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                // Same bound on resume: the client re-presents its declarations each time, so
                // resume is an equally good burst vector (R3-F1).
                let resumed_servers =
                    match accept_acp_servers(parse_acp_mcp_servers(req.params.as_ref())) {
                        Ok(list) => list,
                        Err(msg) => {
                            let resp = JsonRpcResponse::error(id, ACP_OVERLOADED, msg);
                            let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                            continue;
                        }
                    };
                let requested = req
                    .params
                    .as_ref()
                    .and_then(|p| p["sessionId"].as_str())
                    .unwrap_or_default();
                let over_cap = {
                    let guard = sessions.lock().await;
                    !guard.contains_key(requested) && guard.len() >= MAX_SESSIONS_PER_CONNECTION
                };
                if let Some(channel) = derive_channel_id(requested).filter(|_| !over_cap) {
                    if let Some((code, message)) = scope.claim_or_refusal(&channel) {
                        let resp = JsonRpcResponse::error(id, code, message);
                        let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                        continue;
                    }
                }
                let permission_relay = permission_relay_requested(req.params.as_ref());
                let permission_relay_handle = permission_relay.then(|| ClientRequestHandle {
                    out_tx: out_tx.clone(),
                    pending: pending_requests.clone(),
                    next_id: next_req_id.clone(),
                });
                let (mut resp, resumed_channel) =
                    handle_session_resume(&sessions, id.clone(), req.params.as_ref(), mcp_enabled)
                        .await;
                // Report whether the pool's inner agent session actually
                // survived. Gateway-side resume is bookkeeping and always
                // succeeds; without this signal a client cannot tell a live
                // continuation from a session the pool has already evicted,
                // and skips its own recovery (e.g. a history preamble).
                if let Some(ref channel_id) = resumed_channel {
                    if let Some(alive) = query_pool_liveness(&state, channel_id).await {
                        if let Some(result) =
                            resp.result.as_mut().and_then(|value| value.as_object_mut())
                        {
                            result.insert(
                                "_meta".into(),
                                json!({ "dev.openab/sessionAlive": alive }),
                            );
                        }
                    }
                }
                if let (Some(registry), Some(channel_id)) =
                    (state.acp_reply_registry.as_ref(), resumed_channel.as_ref())
                {
                    let session_id = channel_id.replacen("acp_", "sess_", 1);
                    if let Some(session) = sessions.lock().await.get_mut(&session_id) {
                        session.permission_relay = permission_relay_handle.clone();
                    }
                    install_reply_sink(
                        registry,
                        channel_id,
                        ReplySink {
                            turn_id: None,
                            tx: None,
                            session_id,
                            out_tx: out_tx.clone(),
                            owner: connection_id.clone(),
                            generation: connection_generation,
                            permission_relay: permission_relay_handle,
                        },
                    );
                }
                let _ = out_tx.send(serde_json::to_string(&resp).unwrap());

                // Retire tunnels for declarations this resume withdrew.
                //
                // Derived from the REGISTRY, not from a remembered declaration set. The previous
                // version compared against `sessions`, which is built per connection — so on the
                // real reconnect path that map is empty, the lookup returns None, and the withdrawn
                // set was ALWAYS empty. The feature was dead in exactly the case it was written
                // for, and its test passed because it drove a same-connection resume.
                //
                // The registry is process-global and keyed `(channel_id, server_id)`, so
                // "registered under this channel but absent from what the client just declared" IS
                // the withdrawn set — no second record to keep in sync, and correct across a
                // reconnect. A resume re-presents the client's WHOLE declaration set, which is what
                // makes absence meaningful.
                //
                // Handles come out under the lock and are disconnected after it is released
                // (`disconnect` is async, this is a std mutex). Each is owed that disconnect
                // because the client still believes the connection is open — same obligation as a
                // same-name replacement (R7).
                //
                // ABSENT and EMPTY are not the same thing. `mcpServers` omitted entirely means the
                // client said nothing about its servers, so nothing is withdrawn; an explicit `[]`
                // is a client saying it now offers none, which withdraws everything. Treating the
                // two alike was harmless while the withdrawn set was always empty — deriving it
                // from the registry made it destructive, so a compliant client that simply left
                // the optional field out would have every tunnel on its channel torn down.
                // `session/new` has the same reading of absence, and D-06 treats a missing
                // `protocolVersion` as fail-closed; absence should not be the most damaging
                // interpretation here while it is the safest one there.
                // Only a real ARRAY withdraws. `is_some()` was wrong in the case this guard exists
                // for: `null` is a third state, semantically next to absent, and it is the shape a
                // serde `Option<Vec<_>>` without `skip_serializing_if` produces for a field the
                // client left unset — so the most likely real wire form of "omitted" landed on the
                // destructive side. `{}` and `"x"` were swept too, silently, because
                // `parse_acp_mcp_servers` reads through `as_array()` and yields an empty list for
                // anything that is not one. A malformed declaration must not be the most damaging
                // reading available.
                // One reachable way to arrive with an empty `keep` and a present key: the client
                // declared only NON-`type:acp` servers. `parse_acp_mcp_servers` filters by type, so
                // the list empties while the field itself is a perfectly good array. That withdraws
                // every acp tunnel on the channel and is the CORRECT reading — the client
                // re-presented its whole set and there is no acp server in it. Noted because it
                // looks identical to a defect that was reported here and turned out to be
                // unreachable.
                let declared_servers = matches!(
                    req.params.as_ref().and_then(|p| p.get("mcpServers")),
                    Some(Value::Array(_))
                );
                if let (Some(registry), Some(channel_id)) =
                    (state.acp_tunnel_registry.clone(), resumed_channel.as_ref())
                {
                    if declared_servers {
                        let keep: std::collections::HashSet<&str> =
                            resumed_servers.iter().map(|s| s.id.as_str()).collect();
                        let dropped: Vec<TunnelHandle> = {
                            let mut reg = registry.lock().unwrap_or_else(|e| e.into_inner());
                            let stale: Vec<(String, String)> = reg
                                .iter()
                                .filter(|((c, id), h)| {
                                    c == channel_id
                                        && !keep.contains(id.as_str())
                                        // Never retire a tunnel a NEWER connection installed. An
                                        // older connection's late resume carries an out-of-date
                                        // declaration set, so its silence about a newer
                                        // connection's server is not a withdrawal — it simply
                                        // never knew about it.
                                        && h.connection_generation <= connection_generation
                                })
                                .map(|(k, _)| k.clone())
                                .collect();
                            stale.iter().filter_map(|k| reg.remove(k)).collect()
                        };
                        if !dropped.is_empty() {
                            info!(
                                channel = %redact_id(channel_id), retired = dropped.len(),
                                "ACP: resume withdrew declarations — retiring their tunnels"
                            );
                            tokio::spawn(async move {
                                for handle in dropped {
                                    if let Err(e) = handle.disconnect(5).await {
                                        debug!(error = %e, "ACP: mcp/disconnect for a withdrawn declaration did not complete");
                                    }
                                }
                            });
                        }
                    }
                }

                // Re-open + register the browser tunnel(s) on resume too. katashiro persists its
                // ACP session and RECONNECTS via session/resume (not session/new), re-declaring its
                // "type":"acp" browser server each time. Without this, a resumed session records the
                // server but never opens a tunnel, so the facade's capability source reports "no browser
                // attached" — there is no core proxy to report it.
                // ONLY on a resume the handler accepted — `resumed_channel` is that signal. A
                // rejected resume must not touch tunnels: same-name re-attach is last-write-wins,
                // so spawning here would let a refused request (busy, over-cap, unknown session)
                // evict the very tunnel it was refused in favour of. Deriving the channel from the
                // requested sessionId is NOT a sufficient guard — a well-formed id derives fine on
                // every one of those rejection paths.
                if let (Some(registry), Some(channel_id)) =
                    (state.acp_tunnel_registry.clone(), resumed_channel)
                {
                    spawn_acp_tunnels(
                        resumed_servers,
                        channel_id,
                        registry,
                        &out_tx,
                        &pending_requests,
                        &next_req_id,
                        &mut establish_tasks,
                        &connection_id,
                        connection_generation,
                        &connection_closed,
                    );
                }
            }
            "_openab/runtime/state" => {
                let response = if !runtime_control {
                    JsonRpcResponse::error(id, -32003, "Runtime operator credential required")
                } else if !initialized {
                    JsonRpcResponse::error(id, -32002, "Not initialized")
                } else if let Some(inventory) = &state.acp_session_inventory {
                    let mut channels = inventory().await;
                    channels.extend(state.acp_session_operations.channels());
                    channels.retain(|channel| scope.owns(channel));
                    channels.sort();
                    channels.dedup();
                    let mut snapshots = Vec::new();
                    for channel in channels {
                        if let Some(mut snapshot) = read_runtime_snapshot(&state, &channel).await {
                            snapshot["sessionId"] = json!(channel.replacen("acp_", "sess_", 1));
                            snapshots.push(snapshot);
                        }
                    }
                    let usage = runtime_usage::snapshot(
                        state
                            .acp
                            .as_ref()
                            .map(|acp| acp.disk_paths.clone())
                            .unwrap_or_default(),
                    )
                    .await;
                    JsonRpcResponse::success(
                        id,
                        json!({
                            "sessions": snapshots,
                            "authenticated": runtime_authenticated(&state),
                            "usage": usage,
                        }),
                    )
                } else {
                    JsonRpcResponse::error(id, -32601, "Runtime inventory unavailable")
                };
                let _ = out_tx.send(serde_json::to_string(&response).unwrap());
            }
            "_openab/runtime/terminal/start"
            | "_openab/runtime/terminal/ack"
            | "_openab/runtime/terminal/input"
            | "_openab/runtime/terminal/resize"
            | "_openab/runtime/terminal/close" => {
                let response = if !runtime_control {
                    JsonRpcResponse::error(id, -32003, "Runtime operator credential required")
                } else if !initialized {
                    JsonRpcResponse::error(id, -32002, "Not initialized")
                } else {
                    match terminals.request(
                        &req.method,
                        req.params.as_ref().unwrap_or(&Value::Null),
                        out_tx.clone(),
                    ) {
                        Ok(value) => JsonRpcResponse::success(id, value),
                        Err(message) => JsonRpcResponse::error(id, -32006, &message),
                    }
                };
                let _ = out_tx.send(serde_json::to_string(&response).unwrap());
            }
            "_openab/runtime/login"
            | "_openab/runtime/login/cancel"
            | "_openab/runtime/login/input" => {
                let cancelling = req.method.ends_with("/cancel");
                let attempt = req
                    .params
                    .as_ref()
                    .and_then(|params| params["attemptId"].as_str())
                    .map(str::to_string);
                if !runtime_control {
                    let response =
                        JsonRpcResponse::error(id, -32003, "Runtime operator credential required");
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                if !initialized {
                    let response = JsonRpcResponse::error(id, -32002, "Not initialized");
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                if cancelling {
                    let signalled = runtime_login::cancel(attempt.as_deref());
                    let response = JsonRpcResponse::success(id, json!({"cancelled": signalled}));
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                if req.method.ends_with("/input") {
                    let text = req
                        .params
                        .as_ref()
                        .and_then(|params| params["text"].as_str())
                        .unwrap_or_default();
                    let response = match runtime_login::send_input(
                        attempt.as_deref().unwrap_or_default(),
                        text,
                    ) {
                        Ok(()) => JsonRpcResponse::success(id, json!({"delivered": true})),
                        Err((code, message)) => JsonRpcResponse::error(id, code, message),
                    };
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                let Some(attempt) = attempt.filter(|id| runtime_login::valid_attempt_id(id)) else {
                    let response = JsonRpcResponse::error(id, -32602, "Invalid attemptId");
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                };
                let Some(command) = state.acp.as_ref().and_then(|c| c.login_command.clone()) else {
                    let response = JsonRpcResponse::error(
                        id,
                        runtime_login::LOGIN_UNSUPPORTED,
                        "This runtime has no sign-in command configured",
                    );
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                };
                let response = match runtime_login::start(
                    &command,
                    &attempt,
                    &connection_id,
                    out_tx.clone(),
                    state.acp_runtime_suspend.clone(),
                ) {
                    Ok(()) => JsonRpcResponse::success(id, json!({"started": true})),
                    Err((code, message)) => JsonRpcResponse::error(id, code, message),
                };
                let _ = out_tx.send(serde_json::to_string(&response).unwrap());
            }
            "_openab/runtime/job" | "_openab/runtime/job/cancel" => {
                if !runtime_control {
                    let response =
                        JsonRpcResponse::error(id, -32003, "Runtime operator credential required");
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                if !initialized {
                    let response = JsonRpcResponse::error(id, -32002, "Not initialized");
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                if req.method.ends_with("/cancel") {
                    let job_id = req.params.as_ref().and_then(|p| p["jobId"].as_str());
                    let response = match job_id {
                        Some(job_id) => JsonRpcResponse::success(
                            id,
                            json!({"cancelled": runtime_job::cancel(job_id)}),
                        ),
                        None => JsonRpcResponse::error(id, -32602, "Invalid jobId"),
                    };
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                let Some(jobs) = state.acp.as_ref().map(|c| c.runtime_jobs.clone()) else {
                    continue;
                };
                let request = match runtime_job::parse_request(req.params.as_ref(), &jobs) {
                    Ok(request) => request,
                    Err(message) => {
                        let response = JsonRpcResponse::error(id, -32602, message);
                        let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                        continue;
                    }
                };
                let out_tx = out_tx.clone();
                let connection_id = connection_id.clone();
                prompt_tasks.push(tokio::spawn(async move {
                    let response = match runtime_job::run(&jobs, request, &connection_id).await {
                        Ok(result) => JsonRpcResponse::success(id, result),
                        Err((code, message)) => JsonRpcResponse::error(id, code, message),
                    };
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                }));
            }
            "_openab/session/requests" => {
                let response = if !runtime_control {
                    JsonRpcResponse::error(id, -32003, "Runtime operator credential required")
                } else if !initialized {
                    JsonRpcResponse::error(id, -32002, "Not initialized")
                } else if let Some(params) = req.params.as_ref() {
                    if let Some(channel) = params["sessionId"].as_str().and_then(derive_channel_id)
                    {
                        if !scope.owns(&channel) {
                            let response = JsonRpcResponse::error(id, -32003, FOREIGN_SESSION);
                            let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                            continue;
                        }
                        let snapshot = read_runtime_snapshot(&state, &channel).await;
                        if params["operation"] == "register"
                            && !snapshot.as_ref().is_some_and(|s| s["state"] == "active")
                        {
                            let response = JsonRpcResponse::error(
                                id,
                                -32001,
                                "No active runtime operation owns this request",
                            );
                            let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                            continue;
                        }
                        match state.acp_session_requests.handle(&channel, params) {
                            Ok(result) => JsonRpcResponse::success(id, result),
                            Err(error) => JsonRpcResponse::error(id, -32602, error),
                        }
                    } else {
                        JsonRpcResponse::error(id, -32602, "Invalid sessionId")
                    }
                } else {
                    JsonRpcResponse::error(id, -32602, "Missing params")
                };
                let _ = out_tx.send(serde_json::to_string(&response).unwrap());
            }
            "_openab/session/credentials" => {
                let state = state.clone();
                let out_tx = out_tx.clone();
                let params = req.params.clone();
                let scope = scope.clone();
                tokio::spawn(async move {
                    let session = params.as_ref().and_then(|p| p["sessionId"].as_str());
                    let object = |key: &str| {
                        params
                            .as_ref()
                            .map(|p| p[key].clone())
                            .filter(Value::is_object)
                    };
                    let response = if !runtime_control {
                        JsonRpcResponse::error(id, -32003, "Runtime operator credential required")
                    } else if !initialized {
                        JsonRpcResponse::error(id, -32002, "Not initialized")
                    } else if !scope.owns_session(session) {
                        JsonRpcResponse::error(id, -32003, FOREIGN_SESSION)
                    } else if let (Some(channel), Some(expected), Some(credentials), Some(refresh)) = (
                        session.and_then(derive_channel_id),
                        object("expected"),
                        object("credentials"),
                        state.acp_session_credentials.as_ref(),
                    ) {
                        match refresh(channel, expected, credentials).await {
                            Ok(()) => JsonRpcResponse::success(id, json!({})),
                            Err(message) => JsonRpcResponse::error(id, -32004, message),
                        }
                    } else {
                        JsonRpcResponse::error(id, -32602, "Invalid credentials request")
                    };
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                });
            }
            "_openab/session/steer" => {
                let state = state.clone();
                let out_tx = out_tx.clone();
                let params = req.params.clone();
                let scope = scope.clone();
                tokio::spawn(async move {
                    let response = if !runtime_control {
                        JsonRpcResponse::error(id, -32003, "Runtime operator credential required")
                    } else if !initialized {
                        JsonRpcResponse::error(id, -32002, "Not initialized")
                    } else if !scope
                        .owns_session(params.as_ref().and_then(|p| p["sessionId"].as_str()))
                    {
                        JsonRpcResponse::error(id, -32003, FOREIGN_SESSION)
                    } else if let Some(params) = params.as_ref() {
                        let message_id = params["messageId"]
                            .as_str()
                            .filter(|id| Uuid::parse_str(id).is_ok());
                        let channel = params["sessionId"].as_str().and_then(derive_channel_id);
                        let prompt = steering_prompt(params);
                        if let (Some(channel), Some(prompt), Some(steer), Some(message_id)) = (
                            channel,
                            prompt,
                            state.acp_session_steer.as_ref(),
                            message_id,
                        ) {
                            let snapshot = read_runtime_snapshot(&state, &channel).await;
                            if !snapshot
                                .as_ref()
                                .is_some_and(|s| s["actions"]["steer"] == true)
                            {
                                JsonRpcResponse::error(
                                    id,
                                    -32004,
                                    "Runtime cannot accept steering now",
                                )
                            } else {
                                let _steering =
                                    state.acp_session_operations.steering(channel.clone());
                                publish_runtime_snapshot(&state, &channel).await;
                                match steer(channel.clone(), Value::Array(prompt.clone())).await {
                                    Ok(result) => {
                                        if result["outcome"] == "injected" {
                                            let route = state.acp_reply_registry.as_ref().and_then(
                                                |registry| {
                                                    registry
                                                        .lock()
                                                        .unwrap_or_else(|e| e.into_inner())
                                                        .get(&channel)
                                                        .map(|sink| {
                                                            (
                                                                sink.session_id.clone(),
                                                                sink.out_tx.clone(),
                                                            )
                                                        })
                                                },
                                            );
                                            if let Some((session_id, output)) = route {
                                                let text = prompt
                                                    .iter()
                                                    .filter_map(|part| part["text"].as_str())
                                                    .collect::<Vec<_>>()
                                                    .join("\n");
                                                let _ = output.send(json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":session_id,"update":{"sessionUpdate":"steering_message","id":message_id,"text":text}}}).to_string());
                                            }
                                        }
                                        JsonRpcResponse::success(id, result)
                                    }
                                    Err((code, message)) => {
                                        JsonRpcResponse::error(id, code, message)
                                    }
                                }
                            }
                        } else {
                            JsonRpcResponse::error(
                                id,
                                -32602,
                                "Invalid or unsupported steering request",
                            )
                        }
                    } else {
                        JsonRpcResponse::error(id, -32602, "Missing params")
                    };
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                });
            }
            "_openab/session/state" => {
                if !initialized {
                    let resp = JsonRpcResponse::error(id, -32002, "Not initialized");
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                let session_id = req
                    .params
                    .as_ref()
                    .and_then(|p| p.get("sessionId"))
                    .and_then(Value::as_str);
                if !scope.owns_session(session_id) {
                    let response = JsonRpcResponse::error(id, -32003, FOREIGN_SESSION);
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                if snapshots_enabled.load(Ordering::Acquire)
                    && !runtime_control
                    && !sessions
                        .lock()
                        .await
                        .contains_key(session_id.unwrap_or_default())
                {
                    let response = JsonRpcResponse::error(
                        id,
                        -32003,
                        "Session is not attached to this connection",
                    );
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }
                let channel = session_id
                    .and_then(|s| s.strip_prefix("sess_"))
                    .and_then(|s| Uuid::parse_str(s).ok())
                    .map(|id| format!("acp_{id}"));
                let resp = match (channel, state.acp_session_snapshot.as_ref()) {
                    (None, _) => JsonRpcResponse::error(id, -32602, "Invalid sessionId"),
                    (_, None) => JsonRpcResponse::error(id, -32601, "Runtime state unavailable"),
                    (Some(channel), Some(read)) => {
                        let snapshot = if snapshots_enabled.load(Ordering::Acquire) {
                            read_runtime_snapshot(&state, &channel).await.unwrap()
                        } else {
                            read(channel).await
                        };
                        JsonRpcResponse::success(id, snapshot)
                    }
                };
                let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
            }
            "session/prompt" => {
                if req
                    .params
                    .as_ref()
                    .is_some_and(|p| p.get("_runtimeResumeGeneration").is_some())
                {
                    let response = JsonRpcResponse::error(id, -32602, "Reserved runtime parameter");
                    let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    continue;
                }

                if !initialized {
                    let resp = JsonRpcResponse::error(id, -32002, "Not initialized");
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                // Cap concurrent in-flight prompts per connection (drop finished first).
                prompt_tasks.retain(|h| !h.is_finished());
                if prompt_tasks.len() >= MAX_INFLIGHT_PROMPTS {
                    let resp = JsonRpcResponse::error(
                        id,
                        ACP_OVERLOADED,
                        format!("Too many in-flight prompts (max {MAX_INFLIGHT_PROMPTS})"),
                    );
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                // Reserve this prompt's cancel state SYNCHRONOUSLY here — before spawning the
                // async handler — so a `session/cancel` arriving on the very next frame finds
                // `s.cancel` already installed. The read loop is sequential; installing the cancel
                // inside the spawned task (as it was) left a window where an immediate cancel read
                // `s.cancel == None` and was dropped, so the prompt ran uncancelled (R16-F1).
                // Unknown-session / busy are rejected here (moved out of the handler).
                let session_id = match req
                    .params
                    .as_ref()
                    .and_then(|p| p.get("sessionId"))
                    .and_then(|v| v.as_str())
                {
                    Some(s) => s.to_string(),
                    None => {
                        let resp = JsonRpcResponse::error(id, -32602, "Missing sessionId");
                        let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                        continue;
                    }
                };
                let operation = derive_channel_id(&session_id)
                    .map(|channel| state.acp_session_operations.prompt(channel));
                let cancel = Arc::new(tokio::sync::Notify::new());
                {
                    let mut guard = sessions.lock().await;
                    match guard.get_mut(&session_id) {
                        None => {
                            drop(guard);
                            let resp = JsonRpcResponse::error(
                                id,
                                -32602,
                                format!("Unknown session: {}", redact_id(&session_id)),
                            );
                            let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                            continue;
                        }
                        Some(s) if s.busy => {
                            drop(guard);
                            let resp = JsonRpcResponse::error(
                                id,
                                -32001,
                                "Session busy: a prompt is already in progress",
                            );
                            let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                            continue;
                        }
                        Some(s) => {
                            s.busy = true;
                            s.cancel = Some(cancel.clone());
                            if mcp_enabled {
                                refresh_session_passthrough(s, req.params.as_ref());
                            }
                        }
                    }
                }

                // session/prompt is async — spawn a task to handle streaming
                let state_clone = state.clone();
                let sessions_clone = sessions.clone();
                let out_tx_clone = out_tx.clone();
                let conn_for_prompt = connection_id.clone();
                let handle = tokio::spawn(async move {
                    let _operation = operation;
                    handle_session_prompt(
                        &state_clone,
                        &sessions_clone,
                        id,
                        req.params.as_ref(),
                        &out_tx_clone,
                        session_id,
                        cancel,
                        &conn_for_prompt,
                        connection_generation,
                    )
                    .await;
                });
                prompt_tasks.push(handle);
            }
            "session/set_config_option" | "_openab/session/config_options" => {
                if !initialized {
                    let resp = JsonRpcResponse::error(id, -32002, "Not initialized");
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                if !scope.owns_session(req.params.as_ref().and_then(|p| p["sessionId"].as_str())) {
                    let resp = JsonRpcResponse::error(id, -32003, FOREIGN_SESSION);
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                // Keep the reader free to accept cancellations and permission
                // replies while a setting is being acknowledged by the agent.
                if prompt_tasks.len() >= MAX_INFLIGHT_PROMPTS {
                    let resp =
                        JsonRpcResponse::error(id, ACP_OVERLOADED, "Too many in-flight requests");
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                    continue;
                }
                let state = state.clone();
                let out_tx = out_tx.clone();
                prompt_tasks.push(tokio::spawn(async move {
                    let resp = handle_session_config(
                        &state,
                        id,
                        req.params.as_ref(),
                        req.method == "session/set_config_option",
                        mcp_enabled,
                    )
                    .await;
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                }));
            }
            "session/cancel" => {
                if !scope.owns_session(req.params.as_ref().and_then(|p| p["sessionId"].as_str())) {
                    if !is_notification {
                        let response = JsonRpcResponse::error(id, -32003, FOREIGN_SESSION);
                        let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                    }
                    continue;
                }
                if !runtime_control {
                    let session_id = req
                        .params
                        .as_ref()
                        .and_then(|p| p["sessionId"].as_str())
                        .unwrap_or_default();
                    if !sessions.lock().await.contains_key(session_id) {
                        if !is_notification {
                            let response = JsonRpcResponse::error(
                                id,
                                -32003,
                                "Session is not attached to this connection",
                            );
                            let _ = out_tx.send(serde_json::to_string(&response).unwrap());
                        }
                        continue;
                    }
                }
                // Notification form forwards runtime control (no response); a request-shaped
                // cancel is rejected -32600 rather than acked with empty success (R17-F3c).
                if let Some(resp) = handle_session_cancel(
                    &state,
                    &sessions,
                    &state.event_tx,
                    id,
                    req.params.as_ref(),
                    is_notification,
                )
                .await
                {
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                }
            }
            _ => {
                // Unknown method: error a request; ignore an unknown notification.
                if !is_notification {
                    let resp = JsonRpcResponse::error(
                        id,
                        -32601,
                        format!("Method not found: {}", req.method),
                    );
                    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                }
            }
        }

        // Clean up finished tasks (both sets)
        prompt_tasks.retain(|h| !h.is_finished());
        establish_tasks.retain(|h| !h.is_finished());
    }

    if revoked {
        info!(connection = %connection_id, "ACP connection closed: its binding was revoked");
        let _ = close_tx.send(());
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), &mut send_task).await;
    }

    // Drain any in-flight server-initiated requests: dropping each oneshot sender makes the
    // corresponding `send_request` awaiter resolve to "connection closed before response"
    // rather than hang until timeout. Mirrors the close-drain in openab-core connection.rs.
    for (_id, tx) in pending_requests.lock().await.drain() {
        drop(tx);
    }

    // A device sign-in this connection started has nobody left to answer its prompt.
    // The Kubernetes exec channel it replaces died with its request; match that.
    drop(terminals);
    runtime_login::cancel_for_connection(&connection_id);
    runtime_job::cancel_for_connection(&connection_id);

    // --- Disconnect cleanup ---
    // Announce the close BEFORE anything is torn down. An establish that is past its last await
    // point cannot be aborted, so the flag — not `abort()` — is what stops it installing a handle
    // for a connection that no longer exists.
    snapshot_task.abort();
    connection_closed.store(true, std::sync::atomic::Ordering::Release);
    // Abort any in-flight tasks to prevent registry leaks. Establishes are aborted too: a task
    // still waiting on `mcp/connect` would otherwise insert a handle into the registry AFTER the
    // teardown below has run, leaving a dead tunnel registered for a closed connection.
    for handle in prompt_tasks.into_iter().chain(establish_tasks) {
        handle.abort();
    }

    // Remove all of this connection's sessions from the reply + tunnel registries.
    let channel_ids: Vec<String> = {
        let sessions_guard = sessions.lock().await;
        sessions_guard
            .values()
            .map(|s| s.channel_id.clone())
            .collect()
    };
    // Teardown removes only what THIS connection owns. Matching on the key alone is wrong for
    // both registries: a client that reconnects and resumes takes over the same `channel_id`, so a
    // late cleanup from the closing connection would delete the successor's live entry — the
    // reply sink stops delivering, or the tunnel disappears from under a working session.
    if let Some(ref registry) = state.acp_reply_registry {
        let mut reg = registry.lock().unwrap_or_else(|e| e.into_inner());
        reg.retain(|cid, sink| !(channel_ids.contains(cid) && sink.owner == connection_id));
    }
    if let Some(ref registry) = state.acp_tunnel_registry {
        let mut reg = registry.lock().unwrap_or_else(|e| e.into_inner());
        // Compound-key registry (P1): drop this connection's `(channel_id, *)` tunnels only.
        reg.retain(|(cid, _), h| !(channel_ids.contains(cid) && h.owner == connection_id));
    }
    debug!(
        connection = %connection_id,
        sessions_cleaned = channel_ids.len(),
        "ACP connection cleanup complete"
    );

    send_task.abort();
    ACP_ACTIVE_CONNECTIONS.fetch_sub(1, Ordering::Relaxed);
    info!(connection = %connection_id, "ACP client disconnected");
}

/// Live ACP WebSocket connection count, for the unified binary's /statusz.
pub static ACP_ACTIVE_CONNECTIONS: std::sync::atomic::AtomicI64 =
    std::sync::atomic::AtomicI64::new(0);

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

fn handle_initialize(req: &JsonRpcRequest, mcp_http: bool) -> JsonRpcResponse {
    let id = req.id.clone().unwrap_or(Value::Null);
    // Validate the official request (protocolVersion is required) before negotiating.
    let init: crate::adapters::acp_schema::InitializeRequest =
        match serde_json::from_value(req.params.clone().unwrap_or(Value::Null)) {
            Ok(r) => r,
            Err(e) => {
                return JsonRpcResponse::error(
                    id,
                    -32602,
                    format!("Invalid initialize params: {e}"),
                );
            }
        };
    // Negotiate: respond with the version we will use = the lower of the client's and
    // ours. A higher client version negotiates down to ours (the client then decides);
    // a version below our minimum (v1 is the first ACP version) cannot be satisfied.
    let client_version = *init.protocol_version;
    let negotiated = client_version.min(ACP_PROTOCOL_VERSION as u16);
    if negotiated < 1 {
        return JsonRpcResponse::error(
            id,
            -32602,
            format!("Unsupported protocolVersion {client_version}; this agent supports {ACP_PROTOCOL_VERSION}"),
        );
    }
    // Build identity for the version handshake: the image build stamps
    // OPENAB_BUILD_SHA (the git commit the binary was built from) into the
    // environment; clients log it so a deployed runtime that drifted from
    // the source tree they were developed against is observable instead of
    // silent. Absent (local/dev builds) the key is omitted, never guessed.
    let caps_meta = version_handshake_meta(
        std::env::var("OPENAB_BUILD_SHA").ok().as_deref(),
        std::env::var("OPENAB_ADAPTER_VERSION").ok().as_deref(),
    );
    // ACP initialize response. We advertise `sessionCapabilities.resume` (we support
    // session/resume) but NOT `loadSession` — the gateway cannot replay conversation
    // history to the client (it lives inside the downstream agent CLI).
    JsonRpcResponse::success(
        id,
        json!({
            "protocolVersion": negotiated,
            "agentCapabilities": {
                "loadSession": false,
                "_meta": caps_meta,
                // Advertised because the serde default is {http:false, sse:false}, so saying
                // NOTHING already claims "no MCP transport support" — while this gateway ships
                // MCP-over-ACP. Silence was not neutral (R4).
                //
                // http is TRUE only when the OPENAB_ACP_MCP_SERVERS passthrough is enabled
                // (`mcp_http` — session/new then stores the http entries and forwards them to
                // core on each prompt). sse stays FALSE: those declarations are still dropped,
                // so advertising `true` would be a claim with no implementation behind it.
                //
                // The ACP capability is declared as a **reverse-DNS-namespaced `_meta` key**, per
                // the 2026-07-28 MCP `_meta` namespaced-key convention (SEP-1788 — its own reserved
                // keys look like `io.modelcontextprotocol/logLevel`). `dev.openab/acp` is the
                // reverse-DNS of openab's domain (openab.dev) plus the capability key. This is the
                // `_meta` convention, NOT the separate typed `extensions` map (also new in the
                // 2026-07-28 spec): the vendored v1 `McpCapabilities` has only `http`, `sse` and a
                // free-form `_meta` (`acp_schema.rs:6201`), and adding an `extensions` field would
                // fork the generated types, which F1(a) deliberately avoided. It would move to that
                // typed map if and when the vendored schema gains it; the ADR carries that note.
                "mcpCapabilities": {
                    "http": mcp_http,
                    "sse": false,
                    "_meta": { "dev.openab/acp": true }
                },
                "sessionCapabilities": {
                    "resume": {}
                },
                "promptCapabilities": {
                    "image": false,
                    "audio": false,
                    "embeddedContext": false
                }
            },
            "agentInfo": {
                "name": "openab",
                "title": "OpenAB",
                "version": env!("CARGO_PKG_VERSION")
            },
            "authMethods": []
        }),
    )
}

/// Returns the response plus the minted `channel_id`, so the caller can open the
/// MCP-over-ACP tunnel(s) for any declared `"type":"acp"` servers under that key.
async fn handle_session_new(
    sessions: &Arc<tokio::sync::Mutex<HashMap<String, AcpSession>>>,
    id: Value,
    // Parsed http-type mcpServers entries and `_meta` object to store on the
    // session (already env-gated and capped by the caller).
    mcp_servers: Vec<serde_json::Value>,
    session_meta: Option<serde_json::Value>,
) -> (JsonRpcResponse, String) {
    // sessionId and channel_id share one uuid so channel_id is always
    // re-derivable from a persisted sessionId (see session/resume).
    let uuid = Uuid::new_v4();
    let session_id = format!("sess_{uuid}");
    let channel_id = format!("acp_{uuid}");

    sessions.lock().await.insert(
        session_id.clone(),
        AcpSession {
            channel_id: channel_id.clone(),
            busy: false,
            cancel: None,
            mcp_servers,
            session_meta,
            permission_relay: None,
        },
    );

    // Downgraded from info! — sessionId is a resume capability; keep it out of normal logs (F12).
    debug!(session = %redact_id(&session_id), "ACP session created");

    // ACP session/new response is just { sessionId }. Constructed from the generated
    // NewSessionResponse (T2.1) so the wire shape is type-checked against acp_schema; the
    // optional fields skip-serialize, giving the same { "sessionId": ... } wire.
    let resp = crate::adapters::acp_schema::NewSessionResponse {
        session_id: crate::adapters::acp_schema::SessionId(session_id),
        config_options: None,
        meta: None,
        modes: None,
    };
    (
        JsonRpcResponse::success(id, serde_json::to_value(&resp).unwrap()),
        channel_id,
    )
}

/// `session/resume` — re-attach to a session the client persisted, WITHOUT
/// replaying history (per ACP: the agent MUST NOT replay via session/update).
///
/// The client re-presents its `sessionId`; we derive the same deterministic
/// `channel_id`, so the next prompt's GatewayEvent maps to the same core
/// `session_key` (`acp:<channel_id>`) and the existing conversation continues.
/// The core recovers the underlying agent session via its own persisted mapping
/// plus a downstream `session/load` (survives process restart within the agent's
/// retention / `session_ttl_hours`). Whether that succeeds is not observable
/// here — an expired session simply starts fresh, and the core prefixes its
/// first reply with a "Session expired" notice the client can surface.
///
/// Security: `sessionId` is a server-minted, high-entropy capability;
/// `derive_channel_id` requires a well-formed `sess_<uuid>`, keeping the channel
/// inside the `acp_` namespace and rejecting forged ids.
/// Returns the response and, **only when the resume actually succeeded**, the channel it resumed.
/// The caller uses that `Some` as its permission to open tunnels: deriving a channel id from the
/// requested `sessionId` is not sufficient, because a well-formed id derives fine even on the
/// paths that reject the resume (unknown session, per-connection cap, busy).
/// Returns the response, the channel on success, and the declarations this resume RETIRES —
/// servers the session had that the client no longer offers.
///
/// `accepted` is the deduplicated, capped list, threaded in exactly as `session/new` receives it.
/// Re-parsing the raw params here instead stored an unbounded list in the session record while the
/// tunnels were opened from the accepted one, so the two disagreed about what the client declared.
async fn handle_session_resume(
    sessions: &Arc<tokio::sync::Mutex<HashMap<String, AcpSession>>>,
    id: Value,
    params: Option<&Value>,
    // OPENAB_ACP_MCP_SERVERS gate, read by the caller so tests never mutate env.
    mcp_enabled: bool,
) -> (JsonRpcResponse, Option<String>) {
    let session_id = match params
        .and_then(|p| p.get("sessionId"))
        .and_then(|v| v.as_str())
    {
        Some(s) => s.to_string(),
        None => {
            return (
                JsonRpcResponse::error(id, -32602, "Missing sessionId"),
                None,
            )
        }
    };

    let channel_id = match derive_channel_id(&session_id) {
        Some(cid) => cid,
        None => {
            return (
                JsonRpcResponse::error(
                    id,
                    -32602,
                    "Invalid sessionId: expected the form sess_<uuid>",
                ),
                None,
            );
        }
    };

    let mut guard = sessions.lock().await;
    // Same per-connection cap as session/new: resume must not be an unbounded insert
    // path (a client can mint unlimited valid `sess_<uuid>`). An already-present key is
    // exempt so re-resuming an existing session stays idempotent.
    if !guard.contains_key(&session_id) && guard.len() >= MAX_SESSIONS_PER_CONNECTION {
        return (
            JsonRpcResponse::error(
                id,
                ACP_OVERLOADED,
                format!("Too many sessions on this connection (max {MAX_SESSIONS_PER_CONNECTION})"),
            ),
            None,
        );
    }
    // R16-F2: refuse to resume a session that currently has a prompt in flight. The insert
    // below unconditionally rewrites AcpSession{busy:false,cancel:None}, which would drop the
    // active turn's cancel handle — and then that turn's cleanup would clobber the resumed
    // state / registry entry, losing its replies. A busy session is already live on this
    // connection, so reject deterministically instead of stomping it.
    if guard.get(&session_id).is_some_and(|s| s.busy) {
        return (
            JsonRpcResponse::error(
                id,
                -32001,
                "Session busy: a prompt is in progress; cannot resume",
            ),
            None,
        );
    }
    // Same ABSENT-vs-EMPTY reading as the tunnel withdrawal below: only a real
    // `mcpServers` ARRAY replaces the stored http entries; absent/null/malformed
    // keeps them. Gate off → store nothing.
    let declared_array = matches!(
        params.and_then(|p| p.get("mcpServers")),
        Some(Value::Array(_))
    );
    let mcp_servers = if !mcp_enabled {
        Vec::new()
    } else if declared_array {
        parse_http_mcp_servers(params)
    } else {
        guard
            .get(&session_id)
            .map(|s| s.mcp_servers.clone())
            .unwrap_or_default()
    };
    // Likewise for `_meta`: only a real OBJECT replaces the stored one (an
    // oversized one is dropped, not a withdrawal); absent/null/malformed keeps it.
    let stored_meta = guard.get(&session_id).and_then(|s| s.session_meta.clone());
    let declared_object = matches!(params.and_then(|p| p.get("_meta")), Some(Value::Object(_)));
    let session_meta = if !mcp_enabled {
        None
    } else if declared_object {
        parse_session_meta(params).or(stored_meta)
    } else {
        stored_meta
    };
    guard.insert(
        session_id.clone(),
        AcpSession {
            channel_id: channel_id.clone(),
            busy: false,
            cancel: None,
            mcp_servers,
            session_meta,
            permission_relay: None,
        },
    );
    drop(guard);

    debug!(session = %redact_id(&session_id), "ACP session resumed");

    // ACP session/resume response is an empty object (no history replay) — the generated
    // ResumeSessionResponse default serializes to {} (T2.1, type-checked against acp_schema).
    let resp = crate::adapters::acp_schema::ResumeSessionResponse::default();
    (
        JsonRpcResponse::success(id, serde_json::to_value(&resp).unwrap()),
        Some(channel_id),
    )
}

/// Handle `session/cancel`. Per ACP it is a one-way notification. The notification
/// forwards a control event to core; only the inner runtime's terminal response
/// completes the client-facing prompt, preserving one execution-state authority.
/// A request-shaped cancel is rejected with -32600 (R17-F3c).
async fn handle_session_cancel(
    state: &Arc<crate::AppState>,
    sessions: &Arc<tokio::sync::Mutex<HashMap<String, AcpSession>>>,
    event_tx: &tokio::sync::broadcast::Sender<String>,
    id: Value,
    params: Option<&Value>,
    is_notification: bool,
) -> Option<JsonRpcResponse> {
    if !is_notification {
        return Some(JsonRpcResponse::error(
            id,
            -32600,
            "session/cancel is a notification and must not carry an id",
        ));
    }
    let sess_key = params
        .and_then(|p| p.get("sessionId"))
        .and_then(|v| v.as_str());
    if let Some(k) = sess_key {
        let channel_id = sessions
            .lock()
            .await
            .get(k)
            .map(|session| session.channel_id.clone())
            .or_else(|| derive_channel_id(k));
        if let Some(channel_id) = channel_id.clone() {
            if let Some(cancel_native) = state.acp_session_cancel.clone() {
                let cancellation = state.acp_session_automation.cancel_with(&channel_id, || {
                    state.acp_session_requests.cancel_pending(&channel_id);
                    state
                        .acp_session_operations
                        .start_cancellation(channel_id.clone())
                });
                if let Some((operation, generation)) = cancellation {
                    let state = state.clone();
                    let channel = channel_id.clone();
                    tokio::spawn(async move {
                        let _operation = operation;
                        while let Some(read) = &state.acp_session_snapshot {
                            let provider = read(channel.clone()).await;
                            if !state
                                .acp_session_operations
                                .cancelling(&channel, generation)
                            {
                                break;
                            }
                            if state.acp_session_operations.pending_count(&channel) <= 1
                                && provider["state"] != "active"
                                && provider["operation"].as_str().is_none_or(|op| op == "none")
                            {
                                state
                                    .acp_session_operations
                                    .finish_cancellation(&channel, generation);
                                break;
                            }
                            // Await delivery to native stdin. The cancellation guard blocks
                            // successors until this await and the native prompt both settle.
                            let _ = cancel_native(channel.clone()).await;
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        }
                    });
                }
                return None;
            }
            state.acp_session_requests.cancel_pending(&channel_id);
            state.acp_session_automation.cancel(&channel_id);
            let mut event = GatewayEvent::new(
                "acp",
                ChannelInfo {
                    id: channel_id.clone(),
                    channel_type: "dm".into(),
                    thread_id: None,
                    mcp_servers: Vec::new(),
                    session_meta: None,
                },
                SenderInfo {
                    id: "acp_client".into(),
                    name: "acp_client".into(),
                    display_name: "ACP Client".into(),
                    is_bot: false,
                },
                "",
                &format!("acpcancel_{}", Uuid::new_v4()),
                Vec::new(),
            );
            event.event_type = "session_cancel".into();
            match serde_json::to_string(&event) {
                Ok(payload) => {
                    if event_tx.send(payload).is_err() {
                        warn!(session = %redact_id(k), "ACP: cancel could not reach agent backend");
                        send_pool_cancel(state, &channel_id);
                    }
                }
                Err(error) => {
                    warn!(session = %redact_id(k), ?error, "ACP: failed to serialize cancel event");
                }
            }
        }
    }
    None
}

/// Best-effort pool-side cancel: sends the thread key so the pool's agent
/// process receives `session/cancel` on its stdin, stopping the in-flight
/// tool call. A missing sender (standalone gateway) or a closed channel is
/// silently ignored — the gateway-side cancel already stops the stream.
/// The `agentCapabilities._meta` object for `initialize`: the permission-relay
/// capability plus the version handshake. The image build stamps the git
/// commit (`OPENAB_BUILD_SHA`) and the pinned adapter version
/// (`OPENAB_ADAPTER_VERSION`); an unset or empty value omits its key so a
/// local/dev build never reports a guessed identity.
fn version_handshake_meta(
    build_sha: Option<&str>,
    adapter_version: Option<&str>,
) -> serde_json::Map<String, Value> {
    let mut meta = serde_json::Map::new();
    meta.insert("dev.openab/permissionRelay".into(), json!(true));
    for (value, key) in [
        (build_sha, "dev.openab/buildSha"),
        (adapter_version, "dev.openab/adapterVersion"),
    ] {
        if let Some(value) = value.filter(|s| !s.is_empty()) {
            meta.insert(key.into(), json!(value));
        }
    }
    meta
}

fn send_pool_cancel(state: &crate::AppState, channel_id: &str) {
    if let Some(ref cancel) = state.acp_pool_cancel {
        cancel.send(format!("acp:{channel_id}"));
    }
}

/// A persisted session id is already a resume capability. Config control can
/// use that same capability across connections without taking over output.
async fn handle_session_config(
    state: &crate::AppState,
    id: Value,
    params: Option<&Value>,
    write: bool,
    mcp_enabled: bool,
) -> JsonRpcResponse {
    let channel = params
        .and_then(|p| p.get("sessionId"))
        .and_then(Value::as_str)
        .and_then(derive_channel_id);
    let Some(channel) = channel else {
        return JsonRpcResponse::error(id, -32602, "Invalid sessionId");
    };
    let selection = if write {
        let config_id = params
            .and_then(|p| p.get("configId"))
            .and_then(Value::as_str);
        let value = params.and_then(|p| p.get("value")).and_then(Value::as_str);
        match (config_id, value) {
            (Some(key), Some(value))
                if !key.is_empty() && key.len() <= 200 && value.len() <= 500 =>
            {
                Some((key.into(), value.into()))
            }
            _ => return JsonRpcResponse::error(id, -32602, "configId and value must be strings"),
        }
    } else {
        None
    };
    // A restored session runs where its prompts run (its stored or configured working
    // directory), so a client `cwd` here is ignored rather than allowed to move it.
    let restore = if let Some(context) = params.and_then(|p| p.get("restore")) {
        if !mcp_enabled {
            return JsonRpcResponse::error(id, -32601, "Session restore context is disabled");
        }
        let Some(meta) = parse_session_meta(Some(context)) else {
            return JsonRpcResponse::error(id, -32602, "Restore requires bounded session metadata");
        };
        // Restore context must be complete: omission must never clear saved tools.
        // An explicit empty array is the caller's intentional no-tools selection.
        if !matches!(context.get("mcpServers"), Some(Value::Array(_))) {
            return JsonRpcResponse::error(
                id,
                -32602,
                "Restore requires an explicit mcpServers array",
            );
        }
        Some((parse_http_mcp_servers(Some(context)), Some(meta)))
    } else {
        None
    };
    let timeout_secs = if restore.is_some() { 90 } else { 35 };
    let Some(tx) = &state.acp_pool_config else {
        return JsonRpcResponse::error(
            id,
            -32601,
            "Session configuration requires the unified runtime",
        );
    };
    // Cached model-option reads observe the session; only an explicit setting
    // change or restore performs work that belongs in its execution snapshot.
    let _operation = (write || restore.is_some())
        .then(|| state.acp_session_operations.configuration(channel.clone()));
    let (reply, response) = tokio::sync::oneshot::channel();
    if tx
        .try_send(crate::AcpPoolConfigRequest {
            thread_key: format!("acp:{channel}"),
            selection,
            restore,
            reply,
        })
        .is_err()
    {
        return JsonRpcResponse::error(id, ACP_OVERLOADED, "Configuration queue is full");
    }
    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), response).await {
        Ok(Ok(Ok(value))) => JsonRpcResponse::success(id, value),
        Ok(Ok(Err((code, message)))) => JsonRpcResponse::error(id, code, message),
        _ => JsonRpcResponse::error(id, -32603, "Runtime did not confirm session configuration"),
    }
}

/// Ask the pool whether the inner agent session behind this channel is still
/// live. `None` = no bridge wired (standalone gateway), the queue was full, or
/// the pool did not answer within the timeout — callers omit the signal rather
/// than guessing.
async fn query_pool_liveness(state: &crate::AppState, channel_id: &str) -> Option<bool> {
    let tx = state.acp_pool_liveness.as_ref()?;
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    tx.try_send((format!("acp:{channel_id}"), reply_tx)).ok()?;
    tokio::time::timeout(std::time::Duration::from_secs(3), reply_rx)
        .await
        .ok()?
        .ok()
}

/// Derive the deterministic `channel_id` (`acp_<uuid>`) from a client-supplied
/// `sessionId` (`sess_<uuid>`). Returns `None` if malformed — the uuid must
/// parse, which keeps a resumed channel inside the `acp_` namespace and rejects
/// forged ids.
/// A stable, non-reversible tag for an ACP channel or session id, for logs.
///
/// `channel_id` is `acp_<uuid>` and `session_id` is `sess_<same uuid>` — see
/// [`derive_channel_id`] — so either one in a log line is a working `session/resume` credential.
/// Anyone who can read operator logs could take over a live session, and logs travel further than
/// the sessions they describe.
///
/// Dropping the lines to `debug!` would hide them from the operators who need them ("did the
/// extension attach?"), so the id is hashed instead: the same session tags identically on every
/// line, which is what makes a log readable, but the tag cannot be turned back into the id.
pub(crate) fn redact_id(id: &str) -> String {
    // Hash the UUID, not the prefixed string. One session is addressed as `sess_<uuid>` and as
    // `acp_<uuid>`; hashing the whole string gives those two a different tag each, and a third
    // different from `openab-core`, which strips the prefix. That is three tags for one session —
    // and `prompt dispatched` prints two of them on a single line. Correlating a session across
    // logs is the entire reason the tag exists, so producing several defeats the purpose more
    // completely than not redacting would.
    let uuid = id
        .strip_prefix("acp_")
        .or_else(|| id.strip_prefix("sess_"))
        .unwrap_or(id);
    use sha2::{Digest as _, Sha256};
    let digest = Sha256::digest(uuid.as_bytes());
    let short: String = digest.iter().take(4).map(|b| format!("{b:02x}")).collect();
    format!("#{short}")
}

#[cfg(test)]
mod redact_id_cross_encoding {
    /// Both encodings of one session must tag identically, and identically to `openab-core`.
    ///
    /// This assertion existed in `openab-core` and not here, so the gateway diverged silently while
    /// core's own test asserted the property core alone upheld. An invariant that spans two crates
    /// has to be asserted in both — checking it where it happens to hold proves nothing about the
    /// side that breaks it.
    #[test]
    fn both_encodings_of_one_session_produce_one_tag() {
        let u = "00000000-0000-0000-0000-000000000000";
        let a = super::redact_id(&format!("acp_{u}"));
        let s = super::redact_id(&format!("sess_{u}"));
        assert_eq!(a, s, "one session must not read as two");
        assert_eq!(
            a,
            openab_core_tag(u),
            "the gateway's tag must equal openab-core's for the same session, or an operator \
             following one log to the other finds nothing"
        );
    }

    /// Recomputed rather than imported: the crates do not depend on one another, so the shared
    /// value has to be pinned on both sides independently.
    fn openab_core_tag(uuid: &str) -> String {
        use sha2::{Digest as _, Sha256};
        let d = Sha256::digest(uuid.as_bytes());
        format!(
            "#{}",
            d.iter()
                .take(4)
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        )
    }
}

fn derive_channel_id(session_id: &str) -> Option<String> {
    let uuid = session_id.strip_prefix("sess_")?;
    Uuid::parse_str(uuid).ok()?;
    Some(format!("acp_{uuid}"))
}

/// Release a prompt reservation: clear `busy` and drop the cancel handle. Called on every
/// early return once the read loop has reserved the session (R16-F1).
async fn release_prompt(
    sessions: &Arc<tokio::sync::Mutex<HashMap<String, AcpSession>>>,
    session_id: &str,
) {
    if let Some(s) = sessions.lock().await.get_mut(session_id) {
        s.busy = false;
        s.cancel = None;
    }
}

// 8 args: the connection id is threaded in so the reply sink records which connection installed
// it. Bundling these into a struct would hide that relationship at the call site.
#[allow(clippy::too_many_arguments)]
async fn handle_session_prompt(
    state: &Arc<crate::AppState>,
    sessions: &Arc<tokio::sync::Mutex<HashMap<String, AcpSession>>>,
    id: Value,
    params: Option<&Value>,
    out_tx: &mpsc::UnboundedSender<String>,
    // The caller (read loop) already reserved this session SYNCHRONOUSLY: `busy = true` and
    // `cancel` installed under the session lock (R16-F1). This task owns releasing it on return.
    session_id: String,
    cancel: Arc<tokio::sync::Notify>,
    // `acp_conn_*` id of the connection running this prompt, stamped on the reply sink so
    // teardown removes only the sinks this connection installed.
    connection_id: &str,
    // Age of this connection (`connection_generation`), stamped on the reply sink so a newer
    // connection resuming the same session takes over the channel and an older one cannot clobber
    // it (F4).
    connection_generation: u64,
) {
    // sessionId was validated + reserved by the caller; only the prompt body can still be bad.
    let mut blocks = match extract_prompt_params(params) {
        Ok((_sid, blocks)) => blocks,
        Err(e) => {
            let resp = JsonRpcResponse::error(id, -32602, e);
            let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
            release_prompt(sessions, &session_id).await;
            return;
        }
    };

    // The session was reserved a moment ago under the lock; just read its channel_id
    // and stored passthrough values (http mcpServers entries, `_meta`).
    let (channel_id, mcp_servers, session_meta, permission_relay) =
        match sessions.lock().await.get(&session_id) {
            Some(s) => (
                s.channel_id.clone(),
                s.mcp_servers.clone(),
                s.session_meta.clone(),
                s.permission_relay.clone(),
            ),
            None => {
                let resp = JsonRpcResponse::error(
                    id,
                    -32602,
                    format!("Unknown session: {}", redact_id(&session_id)),
                );
                let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
                release_prompt(sessions, &session_id).await;
                return;
            }
        };

    let _operation = state.acp_session_operations.prompt(channel_id.clone());
    if let Some(read) = &state.acp_session_snapshot {
        let provider = read(channel_id.clone()).await;
        if state.acp_session_operations.snapshot(&channel_id)["cancelling"] == true
            || state.acp_session_operations.snapshot(&channel_id)["configuring"]
                .as_u64()
                .unwrap_or(0)
                > 0
            || !matches!(
                provider["state"].as_str(),
                Some("idle" | "dormant" | "interrupted")
            )
            || provider["operation"]
                .as_str()
                .is_some_and(|op| op != "none")
            || !state.acp_session_requests.pending(&channel_id).is_empty()
        {
            let response = JsonRpcResponse::error(id, -32001, "Runtime session is busy");
            let _ = out_tx.send(serde_json::to_string(&response).unwrap());
            release_prompt(sessions, &session_id).await;
            return;
        }
    }

    // Convert to GatewayEvent and dispatch. Build it first so its `event_id` can fence
    // this turn's replies (round-tripped as `GatewayReply.reply_to`).
    // The client's last block is the prompt and the blocks before it stay separate, so an
    // agent that only reads a slash command at the start of the prompt (Claude Code) still
    // finds one the client sent after its own context blocks.
    let prompt_text = blocks.pop().unwrap_or_default();
    let mut event = GatewayEvent::new(
        "acp",
        ChannelInfo {
            id: channel_id.clone(),
            channel_type: "dm".into(),
            thread_id: None,
            mcp_servers,
            session_meta,
        },
        SenderInfo {
            id: "acp_client".into(),
            name: "acp_client".into(),
            display_name: "ACP Client".into(),
            is_bot: false,
        },
        &prompt_text,
        &format!("acpmsg_{}", Uuid::new_v4()),
        Vec::new(),
    );
    event.leading_text = blocks;
    let turn_id = event.event_id.clone();

    // Create reply channel for this prompt and register it, keyed by channel_id with the
    // turn's event id so `handle_reply` can drop a stale reply after timeout/cancel reuse.
    let (reply_tx, mut reply_rx) = mpsc::unbounded_channel::<ReplyChunk>();
    let resume_generation = params
        .and_then(|p| p.get("_runtimeResumeGeneration"))
        .and_then(Value::as_u64);
    let automation_context = event
        .channel
        .session_meta
        .as_ref()
        .is_some_and(|meta| meta["ai.nuphos/runtimeAuthority"] == 2)
        .then(|| {
            (
                event.channel.mcp_servers.clone(),
                event.channel.session_meta.clone(),
            )
        });
    let mut admitted = false;
    let dispatch = state.acp_session_automation.dispatch(
        &channel_id,
        resume_generation,
        automation_context,
        &turn_id,
        || {
            if state.acp_session_operations.snapshot(&channel_id)["cancelling"] == true {
                return Err("Runtime session is busy".into());
            }
            if let Some(registry) = &state.acp_reply_registry {
                if !activate_reply_sink(
                    registry,
                    &channel_id,
                    ReplySink {
                        turn_id: Some(turn_id.clone()),
                        tx: Some(reply_tx),
                        session_id: session_id.clone(),
                        out_tx: out_tx.clone(),
                        owner: connection_id.to_string(),
                        generation: connection_generation,
                        permission_relay,
                    },
                ) {
                    return Err("ACP session output sink is unavailable".into());
                }
            }
            admitted = true;
            state.acp_session_requests.open(&channel_id);
            state.acp_session_operations.accepted(&channel_id);
            if params.and_then(|p| p.pointer("/_meta/ai.nuphos~1acknowledgePrompt")).and_then(Value::as_bool) == Some(true) {
                let _ = out_tx.send(json!({"jsonrpc":"2.0","method":"_openab/session/prompt_accepted","params":{"sessionId":session_id,"requestId":id}}).to_string());
            }
            let payload =
                serde_json::to_string(&event).map_err(|_| "Internal error".to_string())?;
            state
                .event_tx
                .send(payload)
                .map_err(|_| "No agent backend connected".to_string())?;
            Ok(())
        },
    );
    if let Err(error) = dispatch {
        let response = JsonRpcResponse::error(id, -32603, error);
        if admitted {
            state
                .acp_session_operations
                .outcome(&channel_id, serde_json::to_value(&response).unwrap());
        }
        let _ = out_tx.send(serde_json::to_string(&response).unwrap());
        release_prompt(sessions, &session_id).await;
        if let Some(registry) = &state.acp_reply_registry {
            remove_reply_sink_if_owner(registry, &channel_id, &turn_id);
        }
        return;
    }

    debug!(session = %redact_id(&session_id), channel = %redact_id(&channel_id), "ACP: prompt dispatched");

    // Stream replies back as ACP `session/update` notifications.
    let mut sent_len = 0usize;
    let timeout = tokio::time::Duration::from_secs(acp_prompt_idle_timeout_secs());
    // Typed StopReason (T2.1) so the final PromptResponse is constructed from acp_schema.
    let mut stop_reason = crate::adapters::acp_schema::StopReason::EndTurn;
    let mut timed_out = false;
    let mut agent_error = None;

    loop {
        tokio::select! {
            // Reserved for an explicit local interrupt. Client session/cancel
            // is completed by ReplyChunk::Done(runtime_stop_reason) below.
            _ = cancel.notified() => {
                stop_reason = crate::adapters::acp_schema::StopReason::Cancelled;
                break;
            }
            recv = tokio::time::timeout(timeout, reply_rx.recv()) => {
                match recv {
                    Ok(Some(ReplyChunk::Text(full_text))) => {
                        // Emit new text as an `agent_message_chunk` update. See
                        // `stream_delta` for the char-boundary safety guarantee.
                        let delta = match stream_delta(sent_len, &full_text) {
                            Some(d) => d,
                            None => continue,
                        };
                        sent_len = full_text.len();

                        let notification = JsonRpcNotification {
                            jsonrpc: "2.0",
                            method: "session/update".into(),
                            params: json!({
                                "sessionId": session_id,
                                "update": {
                                    "sessionUpdate": "agent_message_chunk",
                                    "content": {"type": "text", "text": delta}
                                }
                            }),
                        };
                        let _ = out_tx.send(serde_json::to_string(&notification).unwrap());
                    }
                    Ok(Some(ReplyChunk::Update(update))) => {
                        // Relay agent-side updates verbatim under the outer session id.
                        // Streamed text arrives here too; count it so the completion
                        // snapshot (`ReplyChunk::Text`) yields no duplicate chunk.
                        if update["sessionUpdate"] == "agent_message_chunk" {
                            if let Some(text) =
                                update.pointer("/content/text").and_then(Value::as_str)
                            {
                                sent_len += text.len();
                            }
                        }
                        let notification = JsonRpcNotification {
                            jsonrpc: "2.0",
                            method: "session/update".into(),
                            params: json!({
                                "sessionId": session_id,
                                "update": update
                            }),
                        };
                        let _ = out_tx.send(serde_json::to_string(&notification).unwrap());
                    }
                    Ok(Some(ReplyChunk::Error(error))) => {
                        agent_error = Some(error);
                        break;
                    }
                    Ok(Some(ReplyChunk::Done(runtime_stop_reason))) => {
                        if let Some(reason) = runtime_stop_reason {
                            stop_reason = reason;
                        }
                        break;
                    }
                    Ok(None) => {
                        agent_error = Some("Agent reply stream closed before completion".into());
                        break;
                    }
                    Err(_) => {
                        warn!(session = %redact_id(&session_id), "ACP: prompt timed out waiting for reply");
                        timed_out = true;
                        break;
                    }
                }
            }
        }
    }

    state
        .acp_session_operations
        .wait_for_steering(&channel_id)
        .await;

    // On timeout, tell the pool to cancel the agent process so it stops the
    // in-flight tool call. The gateway-side cancel (above) only stops the
    // streaming loop; without this the agent process keeps running until the
    // pool's own idle reaper kills it.
    if timed_out {
        send_pool_cancel(state, &channel_id);
    }

    // Cleanup: remove from registry, release busy flag, clear cancel signal.
    // Turn-scoped removal (F4): only remove the sink if THIS turn still owns it. A newer connection
    // resuming the same session (or a reconnect) can have taken over the channel key between this
    // turn's start and its end; `remove_reply_sink_if_owner` matches on `turn_id` so this
    // completion cannot delete the successor's live sink. This was the F5-of-round-3 residual —
    // the per-connection busy gate does not serialize turns across two connections on one session.
    if let Some(ref registry) = state.acp_reply_registry {
        remove_reply_sink_if_owner(registry, &channel_id, &turn_id);
    }
    if let Some(s) = sessions.lock().await.get_mut(&session_id) {
        s.busy = false;
        s.cancel = None;
    }

    // Final response. A backend timeout has no ACP stopReason, so it is an error;
    // otherwise return the turn's PromptResponse { stopReason }.
    let resp = if let Some(error) = agent_error {
        JsonRpcResponse::error(id, -32603, &error)
    } else if timed_out {
        JsonRpcResponse::error(id, -32603, "Timed out waiting for agent backend")
    } else {
        // T2.1: construct the typed PromptResponse; serializes to { "stopReason": ... }.
        let pr = crate::adapters::acp_schema::PromptResponse {
            stop_reason,
            meta: None,
        };
        JsonRpcResponse::success(id, serde_json::to_value(&pr).unwrap())
    };
    state.acp_session_operations.outcome(
        &channel_id,
        json!({"result":resp.result,"error":resp.error}),
    );
    let _ = out_tx.send(serde_json::to_string(&resp).unwrap());
}

fn extract_prompt_params(params: Option<&Value>) -> Result<(String, Vec<String>), String> {
    let params = params.ok_or("Missing params")?;
    let session_id = params
        .get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or("Missing sessionId")?
        .to_string();
    let prompt = params.get("prompt").ok_or("Missing prompt")?;

    // Per the ACP schema the generated `PromptRequest.prompt` is `[ContentBlock]`; a plain
    // string (or any non-array) is non-conformant and rejected below (-32602), never
    // leniently coerced. The base is text-only: an unsupported block type (image / audio /
    // resource / resource_link) is rejected explicitly rather than silently dropped, so the
    // client knows its content was not delivered.
    let text = if let Some(arr) = prompt.as_array() {
        let mut parts: Vec<String> = Vec::with_capacity(arr.len());
        for block in arr {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    let t = block
                        .get("text")
                        .and_then(|t| t.as_str())
                        .ok_or("Text content block missing 'text'")?;
                    parts.push(t.to_string());
                }
                Some("resource_link") => {
                    // Baseline ACP content (every agent MUST accept text + resource_link).
                    // We do not fetch the resource (that would be an SSRF risk); the link
                    // reference is passed through as text so the agent can act on it.
                    //
                    // The generated `ResourceLink` requires BOTH `name` and `uri` (R17-F3b);
                    // an incomplete link is rejected (-32602) rather than silently rendered.
                    let name = block
                        .get("name")
                        .and_then(|v| v.as_str())
                        .ok_or("resource_link content block missing required 'name'")?;
                    let uri = block
                        .get("uri")
                        .and_then(|v| v.as_str())
                        .ok_or("resource_link content block missing required 'uri'")?;
                    // Render as a Markdown link reference using the required `name` (matches
                    // the prior name-preferred labelling; the bare-uri fallback is gone since
                    // `name` is now mandatory).
                    parts.push(format!("[{name}]({uri})"));
                }
                Some(other) => {
                    // Capability-gated variants (image / audio / embedded resource) that
                    // this agent does not advertise in promptCapabilities are rejected
                    // explicitly rather than silently dropped.
                    return Err(format!(
                        "Unsupported prompt content block type '{other}' — this agent advertises no such capability (base accepts text and resource_link)"
                    ));
                }
                None => return Err("Prompt content block missing 'type'".into()),
            }
        }
        parts
    } else {
        // A plain-string `prompt` (or any non-array) does not match the generated
        // `PromptRequest.prompt: [ContentBlock]` shape → -32602 invalid params.
        return Err("Invalid prompt: 'prompt' must be an array of content blocks".into());
    };

    if text.iter().all(|t| t.trim().is_empty()) {
        return Err("Empty prompt".into());
    }

    Ok((session_id, text))
}

// ---------------------------------------------------------------------------
// Reply handler: called when GatewayReply arrives for an ACP session
// ---------------------------------------------------------------------------

/// Process a GatewayReply destined for an ACP session.
/// Called from the unified bridge's reply dispatch logic.
pub struct AcceptedReply {
    channel: String,
    origin: String,
}

pub async fn handle_reply(
    reply: &GatewayReply,
    registry: &AcpReplyRegistry,
) -> Option<AcceptedReply> {
    let key = reply.channel.id.as_str();
    if !key.starts_with("acp_") {
        return None;
    }

    let full_text = reply.content.text.clone();
    // Skip placeholder/draft messages
    if full_text == "…" || full_text == "draft" {
        return None;
    }

    enum Destination {
        Turn {
            tx: mpsc::UnboundedSender<ReplyChunk>,
            turn_id: String,
        },
        Session {
            session_id: String,
            out_tx: mpsc::UnboundedSender<String>,
        },
    }

    let destination = {
        let map = registry.lock().unwrap_or_else(|e| e.into_inner());
        match map.get(key) {
            // Fence stale replies: after a timeout/cancel the channel_id is reused by the
            // next turn. A late reply carries the previous turn's `evt_<uuid>` in
            // `reply_to`; deliver only when it matches the active turn. Empty `reply_to`
            // (no origin id) fails open so legit traffic is never dropped. `"draft"` is
            // the streaming edit loop's placeholder MessageRef id (ACP shows no
            // placeholder message), so mid-turn `edit_message` snapshots carry it —
            // fail open for it too or streaming deltas are all dropped as stale.
            Some(sink) if sink.turn_id.is_some() => {
                if !(reply.reply_to.is_empty()
                    || reply.reply_to == "draft"
                    || sink.turn_id.as_deref() == Some(reply.reply_to.as_str()))
                {
                    debug!(
                        channel = key,
                        "ACP dropping stale reply from a superseded turn"
                    );
                    return None;
                }
                let tx = sink.tx.clone()?;
                Destination::Turn {
                    tx,
                    turn_id: sink.turn_id.clone().expect("checked above"),
                }
            }
            Some(sink) if reply.command.as_deref() == Some("agent_update") => {
                Destination::Session {
                    session_id: sink.session_id.clone(),
                    out_tx: sink.out_tx.clone(),
                }
            }
            Some(_) => {
                debug!(
                    channel = key,
                    "ACP dropping stale reply from a superseded turn"
                );
                return None;
            }
            None => return None,
        }
    };

    let origin = match &destination {
        Destination::Turn { turn_id, .. } => turn_id.clone(),
        Destination::Session { .. } => reply.reply_to.clone(),
    };
    let accepted = || AcceptedReply {
        channel: key.into(),
        origin: origin.clone(),
    };
    let tx = match destination {
        Destination::Turn { tx, turn_id } => {
            match reply.command.as_deref() {
                Some("agent_error") => {
                    let _ = tx.send(ReplyChunk::Error(full_text));
                    remove_reply_sink_if_owner(registry, key, &turn_id);
                    return None;
                }
                None | Some("send_message") => {
                    let _ = tx.send(ReplyChunk::Text(full_text));
                    let _ = tx.send(ReplyChunk::Done(None));
                    // End only this turn's sink. The registry entry also owns
                    // the connection-lifetime output path used by autonomous
                    // session updates, so removing the whole entry here drops
                    // every update emitted between prompts.
                    remove_reply_sink_if_owner(registry, key, &turn_id);
                    return None;
                }
                Some(command) if command.starts_with("finish_turn:") => {
                    let reason = command
                        .strip_prefix("finish_turn:")
                        .and_then(|value| value.parse().ok());
                    let _ = tx.send(ReplyChunk::Text(full_text));
                    let _ = tx.send(ReplyChunk::Done(reason));
                    remove_reply_sink_if_owner(registry, key, &turn_id);
                    return None;
                }
                _ => tx,
            }
        }
        Destination::Session { session_id, out_tx } => {
            if let Ok(update) = serde_json::from_str::<serde_json::Value>(&full_text) {
                let notification = JsonRpcNotification {
                    jsonrpc: "2.0",
                    method: "session/update".into(),
                    params: json!({ "sessionId": session_id, "update": update }),
                };
                return out_tx
                    .send(serde_json::to_string(&notification).unwrap())
                    .ok()
                    .map(|_| accepted());
            }
            return None;
        }
    };

    // The send consumes full_text; keep it in the selected arm, not a fall-through guard.
    #[allow(clippy::collapsible_match)]
    match reply.command.as_deref() {
        Some("edit_message") => {
            // Streaming update — send as text snapshot
            if tx.send(ReplyChunk::Text(full_text)).is_err() {
                debug!(
                    channel = key,
                    "ACP reply send failed (client likely disconnected)"
                );
                registry
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(key);
            }
        }
        Some("agent_update") => {
            // Raw agent-side session/update payload (JSON in the text field).
            if let Ok(update) = serde_json::from_str::<serde_json::Value>(&full_text) {
                return tx.send(ReplyChunk::Update(update)).ok().map(|_| accepted());
            }
        }
        None | Some("send_message") => unreachable!("terminal replies return above"),
        Some(command) if command.starts_with("finish_turn:") => {
            unreachable!("terminal replies return above")
        }
        Some("add_reaction") | Some("remove_reaction") => {
            // Reactions are agent state indicators — could map to notifications later
        }
        _ => {}
    }
    None
}

// ---------------------------------------------------------------------------
// Conformance guard — the wire this server hand-rolls MUST validate against the
// generated ACP v1 types (`acp_schema`). Any casing / field-name / shape drift
// (the exact class of bug fixed during the base build: `agentMessageChunk` →
// `agent_message_chunk`, integer `protocolVersion`, snake_case `stopReason`)
// fails these tests. Also pins the generated types as the schema source of truth
// while the payloads stay hand-rolled (per ADR §7: hand-roll the trivial chat
// subset, generate the complex bidirectional surface).
// ---------------------------------------------------------------------------
#[cfg(test)]
mod acp_conformance {
    use crate::adapters::acp_schema as sc;
    use serde_json::{json, Value};

    /// Assert `wire` (a payload this server emits or accepts) deserializes into the
    /// generated ACP type `T`, and that `T`'s serde is a stable fixed point
    /// (serialize→deserialize→serialize is idempotent). No `PartialEq` needed on `T`.
    fn conforms<T>(wire: Value)
    where
        T: serde::Serialize + serde::de::DeserializeOwned,
    {
        let a: T = serde_json::from_value(wire.clone()).unwrap_or_else(|e| {
            panic!(
                "emitted wire is not valid ACP {}: {e}\n  wire={wire}",
                std::any::type_name::<T>()
            )
        });
        let v1 = serde_json::to_value(&a).unwrap();
        let b: T = serde_json::from_value(v1.clone()).expect("re-parse of generated form");
        let v2 = serde_json::to_value(&b).unwrap();
        assert_eq!(
            v1,
            v2,
            "ACP serde is not a stable fixed point for {}",
            std::any::type_name::<T>()
        );
    }

    // --- outbound responses (exact shapes handle_* emit) ---

    #[test]
    fn initialize_response() {
        // mirror of handle_initialize — checked for both values of mcpCapabilities.http
        // (the OPENAB_ACP_MCP_SERVERS gate).
        for http in [false, true] {
            conforms::<sc::InitializeResponse>(json!({
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": false,
                    // Mirrors handle_initialize, INCLUDING mcpCapabilities — a mirror that stops
                    // mirroring is worse than no mirror, because it still looks like coverage. This
                    // also proves `_meta` is schema-legal here, which is what makes the ACP capability
                    // expressible before upstream has a real field for it.
                    "mcpCapabilities": { "http": http, "sse": false, "_meta": { "dev.openab/acp": true } },
                    "sessionCapabilities": { "resume": {} },
                    "promptCapabilities": { "image": false, "audio": false, "embeddedContext": false }
                },
                "agentInfo": { "name": "openab", "title": "OpenAB", "version": "0.0.0" },
                "authMethods": []
            }));
        }
    }

    #[test]
    fn new_session_response() {
        conforms::<sc::NewSessionResponse>(
            json!({ "sessionId": "sess_00000000-0000-0000-0000-000000000000" }),
        );
    }

    #[test]
    fn resume_session_response() {
        // handle_session_resume returns {}
        conforms::<sc::ResumeSessionResponse>(json!({}));
    }

    #[test]
    fn prompt_response_stop_reasons() {
        // handle_prompt emits end_turn (normal) / cancelled (session/cancel)
        conforms::<sc::PromptResponse>(json!({ "stopReason": "end_turn" }));
        conforms::<sc::PromptResponse>(json!({ "stopReason": "cancelled" }));
    }

    #[test]
    fn session_update_agent_message_chunk() {
        // the streaming notification `params` (session/update)
        conforms::<sc::SessionNotification>(json!({
            "sessionId": "sess_00000000-0000-0000-0000-000000000000",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "PONG 你好 (๑•̀ㅂ•́)و" }
            }
        }));
    }

    #[test]
    fn session_update_liveness_heartbeat() {
        // the broker's liveness heartbeat (openab-core adapter.rs) — an
        // `updatedAt`-only partial SessionInfoUpdate must stay schema-valid,
        // because it is what keeps the idle timer from killing long tool calls.
        conforms::<sc::SessionNotification>(json!({
            "sessionId": "sess_00000000-0000-0000-0000-000000000000",
            "update": {
                "sessionUpdate": "session_info_update",
                "updatedAt": "2026-08-31T12:00:00+00:00"
            }
        }));
    }

    // --- inbound requests (params clients send) ---

    #[test]
    fn prompt_request() {
        conforms::<sc::PromptRequest>(json!({
            "sessionId": "sess_00000000-0000-0000-0000-000000000000",
            "prompt": [{ "type": "text", "text": "PING" }]
        }));
    }

    // --- edge cases: emoji / Unicode / boundary strings (round-trip) ---

    // The multi-byte / multi-codepoint cases a naive wire handler mangles:
    // astral-plane emoji, ZWJ sequence, regional-indicator flag, VS16 emoji,
    // astral-plane CJK, and a mixed run.
    const EDGE_TEXT: &[&str] = &[
        "🎉",                  // U+1F389, 4-byte astral emoji
        "👨‍👩‍👧‍👦",                  // ZWJ family (7 codepoints joined by ZWJ)
        "🇹🇼",                  // regional-indicator pair (flag)
        "❤️",                  // U+2764 + U+FE0F (VS16)
        "𠀀",                  // U+20000, astral-plane CJK
        "🎉 你好 (๑•̀ㅂ•́)و ❤️", // mixed emoji + CJK + kaomoji + VS16
    ];

    #[test]
    fn content_block_emoji_and_unicode() {
        for e in EDGE_TEXT {
            conforms::<sc::ContentBlock>(json!({ "type": "text", "text": e }));
        }
    }

    #[test]
    fn session_update_emoji_chunk() {
        for e in EDGE_TEXT {
            conforms::<sc::SessionNotification>(json!({
                "sessionId": "sess_00000000-0000-0000-0000-000000000000",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": e }
                }
            }));
        }
    }

    #[test]
    fn content_block_boundary_strings() {
        // empty, whitespace/newlines/tabs, JSON-special chars, control chars, and a
        // long string — all must round-trip as plain text.
        let long = "x".repeat(4096);
        for s in [
            "",
            "   \n\t  ",
            "quote:\" backslash:\\ slash:/ braces:{}[]",
            "ctrl:\u{0001}\u{001f} unit-sep",
            long.as_str(),
        ] {
            conforms::<sc::ContentBlock>(json!({ "type": "text", "text": s }));
        }
    }

    #[test]
    fn prompt_response_all_stop_reasons() {
        for sr in [
            "end_turn",
            "max_tokens",
            "max_turn_requests",
            "refusal",
            "cancelled",
        ] {
            conforms::<sc::PromptResponse>(json!({ "stopReason": sr }));
        }
    }

    #[test]
    fn prompt_request_multi_block_emoji() {
        conforms::<sc::PromptRequest>(json!({
            "sessionId": "sess_00000000-0000-0000-0000-000000000000",
            "prompt": [
                { "type": "text", "text": "line 1 🎉" },
                { "type": "text", "text": "你好 ❤️" }
            ]
        }));
    }

    // --- JSON-RPC id semantics (F8): omitted id (notification) vs explicit null (request) ---

    #[test]
    fn jsonrpc_id_presence_distinguishes_notification() {
        // serde's `Option<Value>` collapses BOTH omitted id and explicit `id:null` to
        // `None`, so notification detection must use raw key PRESENCE (as the dispatch
        // does), not the deserialized field.
        let notif: Value =
            serde_json::from_str(r#"{"jsonrpc":"2.0","method":"session/cancel"}"#).unwrap();
        assert!(notif.get("id").is_none(), "no id member → notification");
        let req_null: Value =
            serde_json::from_str(r#"{"jsonrpc":"2.0","method":"session/cancel","id":null}"#)
                .unwrap();
        assert!(
            req_null.get("id").is_some(),
            "explicit id:null → request (id member present)"
        );
        let req_num: Value =
            serde_json::from_str(r#"{"jsonrpc":"2.0","method":"initialize","id":7}"#).unwrap();
        assert_eq!(req_num.get("id"), Some(&json!(7)));
    }

    // --- required-param validation (F9): reject malformed session/new & resume ---

    #[test]
    fn session_param_validation() {
        use super::validate_params;
        // session/new requires { cwd, mcpServers }
        assert!(validate_params::<sc::NewSessionRequest>(Some(
            &json!({"cwd": "/w", "mcpServers": []})
        ))
        .is_ok());
        assert!(
            validate_params::<sc::NewSessionRequest>(Some(&json!({"mcpServers": []}))).is_err(),
            "missing cwd"
        );
        assert!(
            validate_params::<sc::NewSessionRequest>(Some(&json!({"cwd": "/w"}))).is_err(),
            "missing mcpServers"
        );
        assert!(
            validate_params::<sc::NewSessionRequest>(None).is_err(),
            "missing params"
        );
        // session/resume requires { sessionId, cwd }
        assert!(validate_params::<sc::ResumeSessionRequest>(Some(
            &json!({"sessionId": "sess_x", "cwd": "/w", "mcpServers": []})
        ))
        .is_ok());
        assert!(
            validate_params::<sc::ResumeSessionRequest>(Some(&json!({"cwd": "/w"}))).is_err(),
            "missing sessionId"
        );
        assert!(
            validate_params::<sc::ResumeSessionRequest>(Some(&json!({"sessionId": "sess_x"})))
                .is_err(),
            "missing cwd"
        );
    }

    // --- prompt content blocks (F10): unsupported block types rejected, not dropped ---

    #[test]
    fn prompt_content_blocks_baseline_accepted_gated_rejected() {
        use super::extract_prompt_params;
        // text blocks accepted, one entry per block
        let (_, text) = extract_prompt_params(Some(&json!({
            "sessionId": "sess_x",
            "prompt": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]
        })))
        .unwrap();
        assert_eq!(text, ["a", "b"]);
        // resource_link is BASELINE — accepted, rendered as a link reference (not fetched)
        let (_, text) = extract_prompt_params(Some(&json!({
            "sessionId": "sess_x",
            "prompt": [
                {"type": "text", "text": "see"},
                {"type": "resource_link", "uri": "file:///x", "name": "X"}
            ]
        })))
        .unwrap();
        assert_eq!(text, ["see", "[X](file:///x)"]);
        // R17-F3b — `ResourceLink` requires `name`; a link missing it is rejected (-32602),
        // no longer rendered as a bare uri.
        assert!(
            extract_prompt_params(Some(&json!({
                "sessionId": "sess_x",
                "prompt": [{"type": "resource_link", "uri": "https://e/x"}]
            })))
            .is_err(),
            "resource_link missing required 'name' must be rejected"
        );
        // resource_link missing its required uri → error
        assert!(extract_prompt_params(Some(&json!({
            "sessionId": "sess_x",
            "prompt": [{"type": "resource_link", "name": "X"}]
        })))
        .is_err());
        // capability-gated variants (image / audio / embedded resource) are rejected,
        // never silently dropped
        assert!(extract_prompt_params(Some(&json!({
            "sessionId": "sess_x",
            "prompt": [{"type": "image", "data": "..", "mimeType": "image/png"}]
        })))
        .is_err());
        // R17-F3a — a plain-string prompt is non-conformant (schema requires
        // `prompt: [ContentBlock]`) → rejected, surfaced as -32602 at the call site.
        assert!(
            extract_prompt_params(Some(&json!({"sessionId": "sess_x", "prompt": "hello"})))
                .is_err(),
            "a bare string prompt must be rejected, not coerced"
        );
        // an object (non-array, non-string) prompt is likewise rejected.
        assert!(
            extract_prompt_params(Some(
                &json!({"sessionId": "sess_x", "prompt": {"type": "text"}})
            ))
            .is_err(),
            "a non-array prompt must be rejected"
        );
    }

    // --- transport auth gate (F1): no key allowed only on loopback ---

    #[test]
    fn acp_auth_gate_requires_key_off_loopback() {
        use super::acp_auth_ok_for_bind;
        // a non-empty key suffices on any bind
        assert!(acp_auth_ok_for_bind(Some("k"), false, "0.0.0.0:8080").is_ok());
        assert!(acp_auth_ok_for_bind(Some("k"), false, "127.0.0.1:8080").is_ok());
        // no key: loopback binds are allowed
        assert!(acp_auth_ok_for_bind(None, false, "127.0.0.1:8080").is_ok());
        assert!(acp_auth_ok_for_bind(None, false, "localhost:8080").is_ok());
        assert!(acp_auth_ok_for_bind(None, false, "[::1]:8080").is_ok());
        // no key: non-loopback binds are refused
        assert!(acp_auth_ok_for_bind(None, false, "0.0.0.0:8080").is_err());
        assert!(acp_auth_ok_for_bind(None, false, "192.168.1.10:8080").is_err());
        // an empty key is treated as no key
        assert!(acp_auth_ok_for_bind(Some(""), false, "0.0.0.0:8080").is_err());
        assert!(acp_auth_ok_for_bind(Some(""), false, "127.0.0.1:8080").is_ok());
        // a credential store mounts /acp anywhere: it rejects every upgrade until a binding exists
        assert!(acp_auth_ok_for_bind(None, true, "0.0.0.0:8080").is_ok());
    }

    #[test]
    fn subprotocol_token_extraction() {
        use super::subprotocol_token;
        use axum::http::HeaderMap;
        let mut h = HeaderMap::new();
        assert_eq!(subprotocol_token(&h), None); // no header
                                                 // the browser offers "openab.bearer.<token>, acp.v1" → extract the token
        h.insert(
            "sec-websocket-protocol",
            "openab.bearer.abc123, acp.v1".parse().unwrap(),
        );
        assert_eq!(subprotocol_token(&h), Some("abc123"));
        // only the real protocol, no bearer entry → None
        h.insert("sec-websocket-protocol", "acp.v1".parse().unwrap());
        assert_eq!(subprotocol_token(&h), None);
    }
}

// ---------------------------------------------------------------------------
// Streaming slicer — the char-boundary-safe incremental delta logic. A multi-byte
// codepoint (emoji, CJK) would be split here if the wire used byte indexing; these
// pin that it never happens.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod acp_streaming {
    use super::stream_delta;

    /// Replay a sequence of full-text snapshots through the exact loop logic
    /// (`stream_delta` + advancing `sent_len`) and return the concatenated deltas.
    fn replay(snapshots: &[&str]) -> String {
        let mut sent = 0usize;
        let mut out = String::new();
        for snap in snapshots {
            if let Some(delta) = stream_delta(sent, snap) {
                out.push_str(delta);
                sent = snap.len();
            }
        }
        out
    }

    #[test]
    fn append_reconstructs_exactly() {
        assert_eq!(replay(&["", "H", "Hi", "Hi ", "Hi there"]), "Hi there");
    }

    #[test]
    fn multibyte_codepoints_never_split() {
        // each snapshot appends a whole multi-byte grapheme; reconstruction is exact
        let snaps = ["a", "a🎉", "a🎉你", "a🎉你👨‍👩‍👧‍👦", "a🎉你👨‍👩‍👧‍👦🇹🇼", "a🎉你👨‍👩‍👧‍👦🇹🇼❤️"];
        assert_eq!(replay(&snaps), *snaps.last().unwrap());
    }

    #[test]
    fn emoji_appears_whole_in_one_delta() {
        // "ab" already sent; next snapshot adds a 4-byte emoji → delta is the whole emoji
        assert_eq!(stream_delta(2, "ab🎉"), Some("🎉"));
    }

    #[test]
    fn mid_codepoint_sent_len_is_skipped_not_panicked() {
        // sent_len inside the 4-byte emoji (a non-append rewrite) → None, never a panic
        assert_eq!(stream_delta(1, "🎉"), None);
        assert_eq!(stream_delta(2, "🎉"), None);
        assert_eq!(stream_delta(3, "🎉"), None);
    }

    #[test]
    fn no_new_text_returns_none() {
        assert_eq!(stream_delta(5, "hello"), None); // sent == len
        assert_eq!(stream_delta(9, "hello"), None); // sent beyond len (shrink/rewrite)
    }

    #[test]
    fn empty_snapshot_returns_none() {
        assert_eq!(stream_delta(0, ""), None);
    }
}

// ---------------------------------------------------------------------------
// Handler-level tests — call the real handlers (not just literal round-trips) and
// assert their actual output + side effects.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod acp_requests {
    //! T1 — the agent→client REQUEST direction: server-initiated `send_request` (mints an
    //! id, awaits the correlated response) and inbound `route_client_response`.
    use super::{
        mcp_connect, mcp_message_request, new_reply_registry, request_permission,
        route_client_response, send_request, ClientRequestHandle, ReplySink,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use tokio::sync::{mpsc, oneshot};

    /// Answer the inner MCP `initialize` that `establish_and_register_tunnel` now sends after
    /// `mcp/connect`, and swallow the `notifications/initialized` that follows.
    ///
    /// A mock extension that answers only `mcp/connect` leaves the establish waiting on the
    /// handshake, so it never registers — surfacing as "no handle in the registry", which says
    /// nothing about the handshake. Every mock driving a real establish needs this.
    async fn answer_inner_handshake(
        out_rx: &mut mpsc::UnboundedReceiver<String>,
        pending: &Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    ) {
        let f: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
        assert_eq!(
            f["params"]["method"],
            json!("initialize"),
            "expected the inner MCP initialize"
        );
        route_client_response(
            pending,
            &json!({"jsonrpc":"2.0","id":f["id"],"result":{
                "protocolVersion":"2025-06-18","capabilities":{"tools":{}},
                "serverInfo":{"name":"test-ext","version":"0"}
            }}),
        )
        .await;
        // The notification owes no reply, but it must come off the channel so a later
        // `out_rx.recv()` does not mistake it for the frame the test is waiting for.
        let n: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
        assert_eq!(n["params"]["method"], json!("notifications/initialized"));
    }

    fn new_pending() -> Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>> {
        Arc::new(tokio::sync::Mutex::new(HashMap::new()))
    }

    /// Drive `inner_mcp_handshake` against a peer answering `version`, and report the outcome.
    ///
    /// The handshake awaits a reply, so the answer has to be routed from a second task; doing it
    /// inline deadlocks on the `pending` entry that has not been created yet.
    async fn handshake_answering(version: Option<&str>) -> Result<(), String> {
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let pending = new_pending();
        let next_id = AtomicU64::new(1);
        let p2 = pending.clone();
        let version = version.map(str::to_string);
        let responder = tokio::spawn(async move {
            let f: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            let result = match version {
                Some(v) => json!({
                    "protocolVersion": v, "capabilities": {"tools": {}},
                    "serverInfo": {"name": "test-ext", "version": "0"}
                }),
                // A result with no `protocolVersion` at all — the branch that was never in
                // dispute and must keep rejecting.
                None => json!({
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "test-ext", "version": "0"}
                }),
            };
            route_client_response(&p2, &json!({"jsonrpc":"2.0","id":f["id"],"result":result}))
                .await;
            // Drain `notifications/initialized` if the handshake got far enough to send it.
            let _ =
                tokio::time::timeout(std::time::Duration::from_millis(200), out_rx.recv()).await;
        });
        let r = super::inner_mcp_handshake(&out_tx, &pending, &next_id, "conn-1", 5).await;
        let _ = responder.await;
        r
    }

    /// Every revision in the accepted set must be accepted (R5, D-2026-07-30-10).
    ///
    /// Asserted per-revision rather than "the set is non-empty": a membership test that only ever
    /// exercises the requested version would pass for the strict-equality code this replaced.
    #[tokio::test]
    async fn every_supported_inner_revision_is_accepted() {
        for v in super::SUPPORTED_INNER_MCP_PROTOCOL_VERSIONS {
            assert!(
                handshake_answering(Some(v)).await.is_ok(),
                "{v} is in the supported set, so a peer answering it must be accepted"
            );
        }
    }

    /// A peer answering with a revision outside the set is still refused, and the error names both
    /// what we asked for and what we accept — otherwise the operator cannot tell a version
    /// mismatch from an unreachable peer.
    #[tokio::test]
    async fn a_revision_outside_the_set_is_still_refused() {
        let err = handshake_answering(Some("1999-01-01"))
            .await
            .expect_err("an unknown revision must not be negotiated into");
        assert!(
            err.contains("1999-01-01"),
            "the error must name what the peer answered: {err}"
        );
        assert!(
            err.contains(super::INNER_MCP_PROTOCOL_VERSION),
            "the error must name what we requested: {err}"
        );
        assert!(
            err.contains("2024-11-05"),
            "the error must name what we accept, or the operator cannot tell what to change: {err}"
        );
    }

    /// The `None` branch was never in dispute: a result carrying no `protocolVersion` string is
    /// not a compliant answer, and widening acceptance must not have widened this.
    #[tokio::test]
    async fn a_result_with_no_protocol_version_is_refused() {
        let err = handshake_answering(None)
            .await
            .expect_err("no protocolVersion is not a compliant initialize result");
        assert!(
            err.contains("no `protocolVersion`"),
            "unexpected error: {err}"
        );
    }

    #[tokio::test]
    async fn route_client_response_resolves_pending() {
        let pending = new_pending();
        let (tx, rx) = oneshot::channel();
        pending.lock().await.insert(5, tx);
        let consumed = route_client_response(
            &pending,
            &json!({"jsonrpc":"2.0","id":5,"result":{"ok":true}}),
        )
        .await;
        assert!(consumed, "an id+result frame is a response we consume");
        assert_eq!(rx.await.unwrap()["result"]["ok"], json!(true));
        assert!(
            pending.lock().await.is_empty(),
            "the pending entry must be removed"
        );
    }

    #[tokio::test]
    async fn route_client_response_ignores_requests_and_notifications() {
        let pending = new_pending();
        // has `method` → a request, not a response
        assert!(
            !route_client_response(&pending, &json!({"jsonrpc":"2.0","id":1,"method":"foo"})).await
        );
        // notification-shaped, no result/error → not a response
        assert!(!route_client_response(&pending, &json!({"jsonrpc":"2.0","method":"bar"})).await);
        // id present but neither result nor error → not a response
        assert!(!route_client_response(&pending, &json!({"jsonrpc":"2.0","id":2})).await);
    }

    #[tokio::test]
    async fn route_client_response_unknown_id_consumes_without_panic() {
        let pending = new_pending();
        let consumed = route_client_response(
            &pending,
            &json!({"jsonrpc":"2.0","id":99,"error":{"code":-1,"message":"x"}}),
        )
        .await;
        assert!(
            consumed,
            "an unmatched response is still consumed (logged, no panic)"
        );
    }

    #[tokio::test]
    async fn permission_request_is_relayed_with_the_outer_session_id() {
        let registry = new_reply_registry();
        let pending = new_pending();
        let next_id = Arc::new(AtomicU64::new(1));
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        assert!(super::install_reply_sink(
            &registry,
            "acp_channel",
            ReplySink {
                turn_id: None,
                tx: None,
                session_id: "sess_outer".into(),
                out_tx: out_tx.clone(),
                owner: "conn-test".into(),
                generation: 0,
                permission_relay: Some(ClientRequestHandle {
                    out_tx,
                    pending: pending.clone(),
                    next_id,
                }),
            },
        ));

        let registry2 = registry.clone();
        let relay = tokio::spawn(async move {
            request_permission(
                &registry2,
                "acp_channel",
                true,
                json!({
                    "sessionId": "sess_inner",
                    "toolCall": {"toolCallId": "tool-1", "title": "Run command"},
                    "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}]
                }),
            )
            .await
        });

        let frame: serde_json::Value =
            serde_json::from_str(&out_rx.recv().await.expect("permission request frame")).unwrap();
        assert_eq!(frame["method"], json!("session/request_permission"));
        assert_eq!(frame["params"]["sessionId"], json!("sess_outer"));
        assert_eq!(frame["params"]["toolCall"]["toolCallId"], json!("tool-1"));
        assert_eq!(frame["params"]["options"][0]["optionId"], json!("allow"));

        route_client_response(
            &pending,
            &json!({
                "jsonrpc": "2.0",
                "id": frame["id"],
                "result": {"outcome": {"outcome": "selected", "optionId": "allow"}}
            }),
        )
        .await;
        assert_eq!(
            relay.await.unwrap().unwrap(),
            Some(json!({"outcome": {"outcome": "selected", "optionId": "allow"}}))
        );
    }

    // The turn's connection dropped and no client holds the session yet: the request waits
    // for the reattached sink instead of cancelling the tool call.
    #[tokio::test]
    async fn permission_request_waits_for_a_reattached_sink() {
        let registry = new_reply_registry();
        let registry2 = registry.clone();
        let relay = tokio::spawn(async move {
            request_permission(
                &registry2,
                "acp_channel",
                true,
                json!({
                    "sessionId": "sess_inner",
                    "toolCall": {"toolCallId": "tool-1", "title": "Run command"},
                    "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}]
                }),
            )
            .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        assert!(!relay.is_finished(), "no sink yet: the request must wait");

        let pending = new_pending();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        assert!(super::install_reply_sink(
            &registry,
            "acp_channel",
            ReplySink {
                turn_id: None,
                tx: None,
                session_id: "sess_outer".into(),
                out_tx: out_tx.clone(),
                owner: "conn-reattached".into(),
                generation: 1,
                permission_relay: Some(ClientRequestHandle {
                    out_tx,
                    pending: pending.clone(),
                    next_id: Arc::new(AtomicU64::new(1)),
                }),
            },
        ));

        let frame: serde_json::Value =
            serde_json::from_str(&out_rx.recv().await.expect("permission request frame")).unwrap();
        assert_eq!(frame["method"], json!("session/request_permission"));
        assert_eq!(frame["params"]["sessionId"], json!("sess_outer"));
        route_client_response(
            &pending,
            &json!({
                "jsonrpc": "2.0",
                "id": frame["id"],
                "result": {"outcome": {"outcome": "selected", "optionId": "allow"}}
            }),
        )
        .await;
        assert_eq!(
            relay.await.unwrap().unwrap(),
            Some(json!({"outcome": {"outcome": "selected", "optionId": "allow"}}))
        );
    }

    fn permission_sink(owner: &str) -> (ReplySink, mpsc::UnboundedReceiver<String>) {
        let (out_tx, out_rx) = mpsc::unbounded_channel::<String>();
        let sink = ReplySink {
            turn_id: None,
            tx: None,
            session_id: "sess_outer".into(),
            out_tx: out_tx.clone(),
            owner: owner.into(),
            generation: 1,
            permission_relay: Some(ClientRequestHandle {
                out_tx,
                pending: new_pending(),
                next_id: Arc::new(AtomicU64::new(1)),
            }),
        };
        (sink, out_rx)
    }

    // NUPS-1228: a prompt shown longer than the grace window is still re-sent to the reattached
    // client when its connection drops. The window starts at the loss, not at the first send.
    #[tokio::test(start_paused = true)]
    async fn permission_request_open_past_the_grace_window_survives_a_dropped_connection() {
        let registry = new_reply_registry();
        let (sink, mut first_rx) = permission_sink("conn-dropped");
        let first_pending = sink.permission_relay.as_ref().unwrap().pending.clone();
        assert!(super::install_reply_sink(&registry, "acp_channel", sink));

        let registry2 = registry.clone();
        let relay = tokio::spawn(async move {
            request_permission(
                &registry2,
                "acp_channel",
                true,
                json!({
                    "sessionId": "sess_inner",
                    "toolCall": {"toolCallId": "tool-1", "title": "Run command"},
                    "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}]
                }),
            )
            .await
        });
        first_rx
            .recv()
            .await
            .expect("first permission request frame");
        tokio::time::sleep(super::PERMISSION_REATTACH_GRACE + std::time::Duration::from_secs(30))
            .await;
        assert!(
            !relay.is_finished(),
            "the prompt is still waiting on a human"
        );

        // The connection drops the way the disconnect cleanup does it: its sink goes and its
        // pending requests are drained.
        registry.lock().unwrap().remove("acp_channel");
        first_pending.lock().await.clear();
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        assert!(!relay.is_finished(), "no sink yet: the request must wait");

        let (sink, mut second_rx) = permission_sink("conn-reattached");
        let second_pending = sink.permission_relay.as_ref().unwrap().pending.clone();
        assert!(super::install_reply_sink(&registry, "acp_channel", sink));
        let frame: serde_json::Value =
            serde_json::from_str(&second_rx.recv().await.expect("re-sent request")).unwrap();
        assert_eq!(frame["method"], json!("session/request_permission"));
        route_client_response(
            &second_pending,
            &json!({
                "jsonrpc": "2.0",
                "id": frame["id"],
                "result": {"outcome": {"outcome": "selected", "optionId": "allow"}}
            }),
        )
        .await;
        assert_eq!(
            relay.await.unwrap().unwrap(),
            Some(json!({"outcome": {"outcome": "selected", "optionId": "allow"}}))
        );
    }

    #[tokio::test]
    async fn permission_request_keeps_legacy_auto_approve_without_opt_in() {
        let registry = new_reply_registry();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        assert!(super::install_reply_sink(
            &registry,
            "acp_channel",
            ReplySink {
                turn_id: None,
                tx: None,
                session_id: "sess_outer".into(),
                out_tx,
                owner: "conn-test".into(),
                generation: 0,
                permission_relay: None,
            },
        ));

        assert_eq!(
            request_permission(
                &registry,
                "acp_channel",
                false,
                json!({"sessionId": "sess_inner", "options": []}),
            )
            .await
            .unwrap(),
            None
        );
        assert!(
            out_rx.try_recv().is_err(),
            "default policy must not emit a client request"
        );
    }

    #[tokio::test]
    async fn permission_request_never_downgrades_after_a_relay_turn_is_replaced() {
        let registry = new_reply_registry();
        let pending = new_pending();
        let (relay_tx, _relay_rx) = mpsc::unbounded_channel::<String>();
        assert!(super::install_reply_sink(
            &registry,
            "acp_channel",
            ReplySink {
                turn_id: Some("evt_old".into()),
                tx: None,
                session_id: "sess_outer".into(),
                out_tx: relay_tx.clone(),
                owner: "conn-old".into(),
                generation: 1,
                permission_relay: Some(ClientRequestHandle {
                    out_tx: relay_tx,
                    pending,
                    next_id: Arc::new(AtomicU64::new(1)),
                }),
            },
        ));
        let relay_was_required =
            super::permission_relay_required(&registry, "acp_channel").unwrap();
        super::remove_reply_sink_if_owner(&registry, "acp_channel", "evt_old");

        let (replacement_tx, mut replacement_rx) = mpsc::unbounded_channel::<String>();
        assert!(super::install_reply_sink(
            &registry,
            "acp_channel",
            ReplySink {
                turn_id: None,
                tx: None,
                session_id: "sess_outer".into(),
                out_tx: replacement_tx,
                owner: "conn-new".into(),
                generation: 2,
                permission_relay: None,
            },
        ));

        assert!(relay_was_required, "the old turn opted into relay");
        assert!(
            request_permission(
                &registry,
                "acp_channel",
                relay_was_required,
                json!({"sessionId": "sess_inner", "options": []}),
            )
            .await
            .is_err(),
            "a relay-enabled turn must fail closed after reconnect, never return the legacy fallback"
        );
        assert!(
            replacement_rx.try_recv().is_err(),
            "a replacement without relay metadata has no permission request path"
        );
    }

    #[tokio::test]
    async fn send_request_mints_incrementing_ids_and_returns_response() {
        let pending = new_pending();
        let next_id = AtomicU64::new(1);
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

        // Driver: read the emitted request frame, assert its shape, feed a matching response.
        let pending2 = pending.clone();
        let driver = tokio::spawn(async move {
            let frame = out_rx.recv().await.unwrap();
            let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
            assert_eq!(v["jsonrpc"], json!("2.0"));
            assert_eq!(v["id"], json!(1));
            assert_eq!(v["method"], json!("mcp/message"));
            assert_eq!(v["params"]["connectionId"], json!("conn-1"));
            let id = v["id"].as_u64().unwrap();
            route_client_response(
                &pending2,
                &json!({"jsonrpc":"2.0","id":id,"result":{"pong":true}}),
            )
            .await;
        });

        let resp = send_request(
            &out_tx,
            &pending,
            &next_id,
            "mcp/message",
            json!({"connectionId":"conn-1"}),
            5,
        )
        .await
        .unwrap();
        assert_eq!(resp["result"]["pong"], json!(true));
        driver.await.unwrap();
        assert_eq!(
            next_id.load(Ordering::Relaxed),
            2,
            "the id counter advanced"
        );
    }

    #[tokio::test]
    async fn mcp_tunnel_connect_and_message_roundtrip() {
        let pending = new_pending();
        let next_id = AtomicU64::new(1);
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

        // Mock extension: answer mcp/connect with a connectionId, then turn an mcp/message
        // tools/list into an inner result, routing each reply by the frame's own outer id.
        let pending2 = pending.clone();
        let ext = tokio::spawn(async move {
            let f1: serde_json::Value =
                serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            assert_eq!(f1["method"], json!("mcp/connect"));
            assert_eq!(f1["params"]["acpId"], json!("srv-1"));
            route_client_response(
                &pending2,
                &json!({"jsonrpc":"2.0","id":f1["id"],"result":{"connectionId":"conn-9"}}),
            )
            .await;

            let f2: serde_json::Value =
                serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            assert_eq!(f2["method"], json!("mcp/message"));
            assert_eq!(f2["params"]["connectionId"], json!("conn-9"));
            assert_eq!(f2["params"]["method"], json!("tools/list"));
            route_client_response(
                &pending2,
                &json!({"jsonrpc":"2.0","id":f2["id"],"result":{"tools":[{"name":"browser.click"}]}}),
            )
            .await;
        });

        let conn = mcp_connect(&out_tx, &pending, &next_id, "srv-1", 5)
            .await
            .unwrap();
        assert_eq!(conn, "conn-9");
        let result = mcp_message_request(&out_tx, &pending, &next_id, &conn, "tools/list", None, 5)
            .await
            .unwrap();
        assert_eq!(result["tools"][0]["name"], json!("browser.click"));
        ext.await.unwrap();
    }

    #[tokio::test]
    async fn tunnel_handle_mcp_message_roundtrips() {
        let pending = new_pending();
        let next_id = Arc::new(AtomicU64::new(1));
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let handle = super::TunnelHandle {
            owner: "conn-test".into(),
            out_tx,
            pending: pending.clone(),
            next_id,
            connection_id: "conn-9".into(),
            server_name: "browser".into(),
            generation: 0,
            connection_generation: 0,
        };

        let pending2 = pending.clone();
        let ext = tokio::spawn(async move {
            let f: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            assert_eq!(f["method"], json!("mcp/message"));
            assert_eq!(f["params"]["connectionId"], json!("conn-9"));
            assert_eq!(f["params"]["method"], json!("tools/call"));
            route_client_response(
                &pending2,
                &json!({"jsonrpc":"2.0","id":f["id"],"result":{"ok":true}}),
            )
            .await;
        });

        let result = handle
            .mcp_message("tools/call", Some(json!({"name": "browser.click"})), 5)
            .await
            .unwrap();
        assert_eq!(result["ok"], json!(true));
        ext.await.unwrap();
    }

    /// A handle with chosen ordering numbers, for asserting on resolution directly.
    ///
    /// The establish path cannot produce two tunnels under one name, so a state that only
    /// `resolve_by_name` has to cope with has to be built by hand.
    ///
    /// **Give every handle a distinct rank.** `resolve_by_name` compares with a strict `>`, so on a
    /// tie the first one the registry iterator happens to yield wins — and that order is not stable.
    /// Real handles cannot tie, because `fetch_add` makes the attach number unique; only handmade
    /// ones can. A test built on two equal ranks would be intermittently wrong for a reason with no
    /// visible connection to what it was testing.
    fn tunnel_ranked(owner: &str, conn_gen: u64, gen: u64) -> super::TunnelHandle {
        let (out_tx, _rx) = mpsc::unbounded_channel::<String>();
        super::TunnelHandle {
            out_tx,
            pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
            connection_id: format!("{owner}-conn"),
            server_name: "katashiro".into(),
            owner: owner.into(),
            connection_generation: conn_gen,
            generation: gen,
        }
    }

    /// `resolve_by_name` picks the newest attach when a name somehow has two tunnels.
    ///
    /// The registry keeps declared names unique, so this state should not arise — which is exactly
    /// why the behaviour needs pinning. The caller this replaced enumerated and took the FIRST match,
    /// and a first match is whatever the map iterator happened to yield: correct only while the
    /// invariant holds, and silently arbitrary the moment it does not. Constructed directly here
    /// because the establish path will not produce it.
    ///
    /// Newest-wins rather than an error, deliberately: refusing with "ambiguous, pass a server_id" is
    /// the behaviour ADR §6.1 exists to avoid, since it locks a client out of its own tools on every
    /// reconnect. A soft inconsistency should not become a hard stop.
    #[test]
    fn resolve_by_name_routes_to_the_newest_attach_if_a_name_is_ever_duplicated() {
        let registry = super::new_tunnel_registry();
        {
            let mut reg = registry.lock().unwrap();
            // Deliberately out of insertion order relative to rank, so a "first match" answer and a
            // "newest" answer differ.
            reg.insert(
                ("acp_1".into(), "srv-new".into()),
                tunnel_ranked("conn-b", 7, 2),
            );
            reg.insert(
                ("acp_1".into(), "srv-old".into()),
                tunnel_ranked("conn-a", 3, 9),
            );
            reg.insert(("acp_1".into(), "other".into()), {
                let mut h = tunnel_ranked("conn-c", 9, 9);
                h.server_name = "notes".into();
                h
            });
            reg.insert(
                ("acp_2".into(), "elsewhere".into()),
                tunnel_ranked("conn-d", 99, 99),
            );
        }
        assert_eq!(
            super::resolve_by_name(&registry, "acp_1", "katashiro").as_deref(),
            Some("srv-new"),
            "must pick the higher (connection_generation, generation), not whichever the map yields \
             first — note srv-old has the larger attach number, so attach order alone answers wrong"
        );
        assert_eq!(
            super::resolve_by_name(&registry, "acp_1", "notes").as_deref(),
            Some("other"),
            "a different declared name on the same channel resolves independently"
        );
        assert_eq!(
            super::resolve_by_name(&registry, "acp_1", "absent"),
            None,
            "an unknown name resolves to nothing rather than to an arbitrary tunnel"
        );
        assert_eq!(
            super::resolve_by_name(&registry, "acp_other", "katashiro"),
            None,
            "resolution is scoped to the channel — another channel's tunnel must not be reachable"
        );
    }

    /// The ineffective-timeout boundary is inclusive on the ceiling.
    ///
    /// Equal is the case that matters and the one an inverted comparison would drop: at exactly the
    /// idle timeout the two clocks start together and which fires first is undecided, so the value
    /// cannot be relied on to decide anything — that is the whole reason the margin exists.
    #[test]
    fn a_tunnel_timeout_at_or_above_the_idle_timeout_is_ineffective() {
        let ceiling = super::ACP_PROMPT_IDLE_TIMEOUT_SECS;
        assert!(
            super::tunnel_timeout_is_ineffective(ceiling),
            "equal to the ceiling must count as ineffective: the two clocks start together, so \
             neither reliably wins"
        );
        assert!(super::tunnel_timeout_is_ineffective(ceiling + 1));
        assert!(
            !super::tunnel_timeout_is_ineffective(ceiling - 1),
            "one second beneath the ceiling is the intended configuration, not a warning"
        );
        // The shipped default cannot be checked here: this crate does not depend on the one that
        // owns it. That pairing is asserted in the binary, which is the only place both are visible.
    }

    /// An establish that finishes after its connection closed must not register.
    ///
    /// The connection's tasks are aborted at teardown, but `abort()` only takes effect at an await
    /// point and there is none between the inner handshake completing and the registry insert. On
    /// a multi-thread runtime that section runs concurrently with teardown's `retain`, so a late
    /// establish could drop a handle owned by a dead connection into a slot the retain had already
    /// emptied — where nothing would ever remove it, because every cleanup path is scoped to a
    /// connection that no longer exists.
    ///
    /// The generation stamp does NOT cover this: it can only lose to a handle that is still there,
    /// and after teardown the slot is empty. Both Mira and I claimed otherwise; Orca showed the
    /// empty-slot case, and this is the guard that closes it.
    #[tokio::test]
    async fn an_establish_that_finishes_after_teardown_does_not_register() {
        let pending = new_pending();
        let next_id = Arc::new(AtomicU64::new(1));
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let registry = super::new_tunnel_registry();
        let closed = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let pending2 = pending.clone();
        let closed2 = closed.clone();
        let ext = tokio::spawn(async move {
            let f: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            route_client_response(
                &pending2,
                &json!({"jsonrpc":"2.0","id":f["id"],"result":{"connectionId":"conn-9"}}),
            )
            .await;
            // Close BEFORE answering the handshake, not after. The establish cannot get past its
            // handshake until this reply lands, so the flag is ordered by the reply channel itself
            // rather than by timing. Setting it afterwards is a real race that the establish
            // usually WINS — it goes straight from the handshake to the lock without waiting for
            // this task, registers, sends no disconnect, and the `recv` below then blocks forever.
            // The first version of this test did that and hung the whole suite.
            closed2.store(true, std::sync::atomic::Ordering::Release);
            answer_inner_handshake(&mut out_rx, &pending2).await;
            // Bounded: a regression must fail, not hang. An unbounded `recv` turns "no disconnect
            // was sent" into a stuck suite, which is strictly worse than a red test.
            tokio::time::timeout(std::time::Duration::from_secs(10), out_rx.recv())
                .await
                .expect("timed out waiting for the mcp/disconnect a stood-down establish owes")
        });

        super::establish_and_register_tunnel(
            out_tx,
            pending,
            next_id,
            "srv-1".into(),
            "browser".into(),
            "acp_abc".into(),
            registry.clone(),
            5,
            "conn-test".into(),
            0,
            closed,
        )
        .await
        .unwrap();

        // Registry first. With the guard removed the establish does NOT stand down — it registers —
        // so awaiting the mock here would fail on "no disconnect from a stood-down establish",
        // naming a thing that did not happen and costing a 10s timeout to say it. This ordering
        // rule has now been needed three times in this file: run the assertion whose truth differs
        // between fixed and broken FIRST, and it is not the same assertion in every test.
        assert!(
            registry.lock().unwrap().is_empty(),
            "an establish registered a tunnel for a connection that had already closed — nothing \
             else can remove it, because every cleanup path is scoped to that dead connection"
        );
        let disconnect = ext.await.unwrap();
        let frame: serde_json::Value = serde_json::from_str(&disconnect.expect(
            "the stood-down establish still owes its client an mcp/disconnect for the connection \
             it opened",
        ))
        .unwrap();
        assert_eq!(frame["method"], json!("mcp/disconnect"));
    }

    #[tokio::test]
    async fn establish_tunnel_registers_handle_under_channel_and_server_id() {
        let pending = new_pending();
        let next_id = Arc::new(AtomicU64::new(1));
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let registry = super::new_tunnel_registry();

        // mock extension: answer mcp/connect with a connectionId
        let pending2 = pending.clone();
        let ext = tokio::spawn(async move {
            let f: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            assert_eq!(f["method"], json!("mcp/connect"));
            assert_eq!(f["params"]["acpId"], json!("srv-1"));
            route_client_response(
                &pending2,
                &json!({"jsonrpc":"2.0","id":f["id"],"result":{"connectionId":"conn-9"}}),
            )
            .await;
            answer_inner_handshake(&mut out_rx, &pending2).await;
        });

        super::establish_and_register_tunnel(
            out_tx,
            pending,
            next_id,
            "srv-1".into(),
            "browser".into(),
            "acp_abc".into(),
            registry.clone(),
            5,
            "conn-test".into(),
            0,
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
        )
        .await
        .unwrap();
        ext.await.unwrap();

        let reg = registry.lock().unwrap();
        let handle = reg.get(&("acp_abc".to_string(), "srv-1".to_string()));
        assert!(
            handle.is_some(),
            "a TunnelHandle must be registered under (channel_id, server_id)"
        );
        assert_eq!(
            handle.unwrap().server_name(),
            "browser",
            "the declared name must survive registration — tool prefixes and the trust allowlist \
             match on it, not on the per-connection id"
        );
    }

    /// Drive one `establish_and_register_tunnel` against a mock client that answers `mcp/connect`.
    async fn attach(registry: &super::AcpTunnelRegistry, server_id: &str, name: &str) {
        let pending = new_pending();
        let next_id = Arc::new(AtomicU64::new(1));
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let pending2 = pending.clone();
        let ext = tokio::spawn(async move {
            let f: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            route_client_response(
                &pending2,
                &json!({"jsonrpc":"2.0","id":f["id"],"result":{"connectionId":"conn-1"}}),
            )
            .await;
            answer_inner_handshake(&mut out_rx, &pending2).await;
        });
        super::establish_and_register_tunnel(
            out_tx,
            pending,
            next_id,
            server_id.into(),
            name.into(),
            "acp_abc".into(),
            registry.clone(),
            5,
            "conn-test".into(),
            0,
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
        )
        .await
        .unwrap();
        ext.await.unwrap();
    }

    /// Last-attach-wins (ADR §6.1): the client mints a fresh `id` per connection, so a reconnect
    /// re-declares the same `name` under a new id. The new tunnel must replace the stale one
    /// rather than coexist with it — coexistence is what would make routing ambiguous and wedge
    /// the client out of its own tools on every reconnect.
    #[tokio::test]
    async fn reattaching_same_name_evicts_the_stale_tunnel() {
        let registry = super::new_tunnel_registry();
        attach(&registry, "uuid-old", "browser").await;
        attach(&registry, "uuid-new", "browser").await;

        let reg = registry.lock().unwrap();
        assert_eq!(
            reg.len(),
            1,
            "the reconnect must evict the stale same-name tunnel, not accumulate beside it"
        );
        assert!(
            reg.contains_key(&("acp_abc".to_string(), "uuid-new".to_string())),
            "the most recently attached tunnel is the one that survives"
        );
    }

    /// A replaced tunnel is owed an `mcp/disconnect` (review R7).
    ///
    /// Last-attach-wins used to simply drop the stale handle, so the only `mcp_disconnect` impl
    /// was never called and the client kept believing that connection was open — stale state that
    /// accumulates across every reconnect.
    #[tokio::test]
    async fn a_replaced_tunnel_is_told_to_disconnect() {
        let registry = super::new_tunnel_registry();

        // First attach. Keep this connection's out_rx alive so the disconnect can be observed on
        // it once the handle has been replaced.
        let pending = new_pending();
        let next_id = Arc::new(AtomicU64::new(1));
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let pending2 = pending.clone();
        let ext = tokio::spawn(async move {
            let f: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            assert_eq!(f["method"], json!("mcp/connect"));
            route_client_response(
                &pending2,
                &json!({"jsonrpc":"2.0","id":f["id"],"result":{"connectionId":"conn-old"}}),
            )
            .await;
            answer_inner_handshake(&mut out_rx, &pending2).await;
            out_rx // hand the receiver back so the test can keep reading it
        });
        super::establish_and_register_tunnel(
            out_tx,
            pending,
            next_id,
            "uuid-old".into(),
            "browser".into(),
            "acp_abc".into(),
            registry.clone(),
            5,
            "conn-test".into(),
            0,
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
        )
        .await
        .unwrap();
        let mut out_rx = ext.await.unwrap();

        // Same declared name, fresh id — this replaces the handle above.
        attach(&registry, "uuid-new", "browser").await;

        // The replaced connection must be told to close, naming ITS connectionId.
        let frame = tokio::time::timeout(std::time::Duration::from_secs(5), out_rx.recv())
            .await
            .expect("a replaced tunnel must be sent mcp/disconnect")
            .expect("channel closed before the disconnect arrived");
        let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(v["method"], json!("mcp/disconnect"));
        assert_eq!(
            v["params"]["connectionId"],
            json!("conn-old"),
            "the disconnect must name the replaced connection, not the live one"
        );
    }

    /// A different declared name on the same channel is a genuinely different server and must
    /// coexist — that is the whole point of the compound key (§6.1/§6.2 fan-out).
    #[tokio::test]
    async fn different_names_on_one_channel_coexist() {
        let registry = super::new_tunnel_registry();
        attach(&registry, "uuid-b", "browser").await;
        attach(&registry, "uuid-o", "other").await;

        assert_eq!(
            registry.lock().unwrap().len(),
            2,
            "distinct declared names are distinct servers and must both stay registered"
        );
    }
}

#[cfg(test)]
mod acp_handlers {
    use super::{
        handle_initialize, handle_session_new, handle_session_resume, parse_acp_mcp_servers,
        parse_http_mcp_servers, parse_session_meta, permission_relay_requested,
        refresh_session_passthrough, AcpMcpServer, AcpSession, JsonRpcRequest,
        MAX_ACP_SERVERS_PER_SESSION, MAX_SESSION_META_BYTES,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Arc;
    use uuid::Uuid;

    fn new_sessions() -> Arc<tokio::sync::Mutex<HashMap<String, AcpSession>>> {
        Arc::new(tokio::sync::Mutex::new(HashMap::new()))
    }

    fn init_req(params: Option<serde_json::Value>) -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".into(),
            method: "initialize".into(),
            id: Some(json!(1)),
            params,
        }
    }

    #[test]
    fn initialize_returns_conformant_capabilities() {
        let v = serde_json::to_value(handle_initialize(
            &init_req(Some(json!({"protocolVersion": 1}))),
            false,
        ))
        .unwrap();
        assert_eq!(v["id"], json!(1));
        let result = &v["result"];
        assert_eq!(result["protocolVersion"], json!(1));
        assert_eq!(result["agentCapabilities"]["loadSession"], json!(false));
        assert!(result["agentCapabilities"]["sessionCapabilities"]["resume"].is_object());
        assert!(result["authMethods"].is_array());

        // R4: advertised explicitly. Before this, `mcpCapabilities` was absent and clients read
        // the serde default {http:false, sse:false} — the same VALUES, but arrived at by silence
        // while the gateway ships MCP-over-ACP and says so nowhere.
        let mcp = &result["agentCapabilities"]["mcpCapabilities"];
        assert_eq!(
            mcp["http"],
            json!(false),
            "no code forwards an http declaration anywhere"
        );
        assert_eq!(
            mcp["sse"],
            json!(false),
            "same for sse — parse_acp_mcp_servers drops both"
        );
        assert_eq!(
            mcp["_meta"]["dev.openab/acp"],
            json!(true),
            "the ACP capability is a reverse-DNS-namespaced extension under _meta (F1(b))"
        );
        assert!(
            mcp["_meta"]["acp"].is_null(),
            "the bare `_meta.acp` key is gone — the informal convention the framework supersedes"
        );
        assert!(
            mcp.get("acp").is_none(),
            "no core mcpCapabilities.acp field (would fork the schema)"
        );
        assert_eq!(
            result["agentCapabilities"]["_meta"]["dev.openab/permissionRelay"],
            json!(true)
        );
    }

    #[test]
    fn permission_relay_requires_an_explicit_session_opt_in() {
        assert!(!permission_relay_requested(None));
        assert!(!permission_relay_requested(Some(&json!({"_meta": {}}))));
        assert!(!permission_relay_requested(Some(
            &json!({"_meta": {"dev.openab/permissionPolicy": "auto"}}),
        )));
        assert!(permission_relay_requested(Some(
            &json!({"_meta": {"dev.openab/permissionPolicy": "relay"}}),
        )));
    }

    #[test]
    fn initialize_negotiates_version_and_rejects_bad() {
        // a higher client version negotiates down to ours (1)
        let v = serde_json::to_value(handle_initialize(
            &init_req(Some(json!({"protocolVersion": 5}))),
            false,
        ))
        .unwrap();
        assert_eq!(v["result"]["protocolVersion"], json!(1));
        // version 0 is below our minimum → -32602
        let v = serde_json::to_value(handle_initialize(
            &init_req(Some(json!({"protocolVersion": 0}))),
            false,
        ))
        .unwrap();
        assert_eq!(v["error"]["code"], json!(-32602));
        // missing protocolVersion → -32602
        let v = serde_json::to_value(handle_initialize(&init_req(Some(json!({}))), false)).unwrap();
        assert_eq!(v["error"]["code"], json!(-32602));
        // missing params → -32602
        let v = serde_json::to_value(handle_initialize(&init_req(None), false)).unwrap();
        assert_eq!(v["error"]["code"], json!(-32602));
    }

    #[tokio::test]
    async fn session_new_mints_and_stores_a_session() {
        let sessions = new_sessions();
        let v = serde_json::to_value(
            handle_session_new(&sessions, json!(2), Vec::new(), None)
                .await
                .0,
        )
        .unwrap();
        let sid = v["result"]["sessionId"].as_str().unwrap();
        assert!(
            sid.starts_with("sess_"),
            "sessionId must be sess_<uuid>: {sid}"
        );
        assert!(
            sessions.lock().await.contains_key(sid),
            "session must be stored"
        );
    }

    #[test]
    fn parse_acp_mcp_servers_keeps_only_acp_entries() {
        let params = json!({
            "cwd": "/w",
            "mcpServers": [
                {"type": "acp", "id": "srv-1", "name": "browser"},
                {"type": "http", "url": "http://x"},
                {"type": "acp", "id": "srv-2", "name": "other"}
            ]
        });
        assert_eq!(
            parse_acp_mcp_servers(Some(&params)),
            vec![
                AcpMcpServer {
                    id: "srv-1".into(),
                    name: "browser".into()
                },
                AcpMcpServer {
                    id: "srv-2".into(),
                    name: "other".into()
                },
            ]
        );
        // no mcpServers -> empty
        assert!(parse_acp_mcp_servers(Some(&json!({"cwd": "/w"}))).is_empty());
        assert!(parse_acp_mcp_servers(None).is_empty());
    }

    #[test]
    fn parse_http_mcp_servers_keeps_http_entries_verbatim_and_caps() {
        let http = json!({
            "name": "nuphos-credentials",
            "type": "http",
            "url": "https://x.example/mcp",
            "headers": [{"name": "Authorization", "value": "Bearer t"}]
        });
        let params = json!({
            "cwd": "/w",
            "mcpServers": [
                {"type": "acp", "id": "srv-1", "name": "browser"},
                http,
                {"type": "stdio", "name": "s", "command": "x"},
                {"type": "sse", "name": "e", "url": "https://sse"},
                {"name": "typeless"}
            ]
        });
        assert_eq!(parse_http_mcp_servers(Some(&params)), vec![http]);
        assert!(parse_http_mcp_servers(Some(&json!({"cwd": "/w"}))).is_empty());
        assert!(parse_http_mcp_servers(None).is_empty());

        // Over-declaration is bounded deterministically: extras dropped, no error.
        let many: Vec<serde_json::Value> = (0..MAX_ACP_SERVERS_PER_SESSION + 4)
            .map(|i| json!({"type": "http", "name": format!("s{i}"), "url": "https://x"}))
            .collect();
        let kept = parse_http_mcp_servers(Some(&json!({"mcpServers": many})));
        assert_eq!(kept.len(), MAX_ACP_SERVERS_PER_SESSION);
        assert_eq!(kept[0]["name"], json!("s0"), "first entries win, in order");
    }

    #[tokio::test]
    async fn session_new_stores_http_mcp_servers_on_the_session() {
        let sessions = new_sessions();
        let server = json!({"type": "http", "name": "creds", "url": "https://x/mcp"});
        let v = serde_json::to_value(
            handle_session_new(&sessions, json!(2), vec![server.clone()], None)
                .await
                .0,
        )
        .unwrap();
        let sid = v["result"]["sessionId"].as_str().unwrap().to_string();
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().mcp_servers,
            vec![server]
        );
    }

    #[tokio::test]
    async fn resume_absent_mcp_servers_keeps_stored_entries_and_empty_clears() {
        let sessions = new_sessions();
        let server = json!({"type": "http", "name": "creds", "url": "https://x/mcp"});
        let v = serde_json::to_value(
            handle_session_new(&sessions, json!(1), vec![server.clone()], None)
                .await
                .0,
        )
        .unwrap();
        let sid = v["result"]["sessionId"].as_str().unwrap().to_string();

        // Omitted mcpServers: the client said nothing → stored entries survive.
        let absent = json!({"sessionId": sid, "cwd": "/w"});
        handle_session_resume(&sessions, json!(2), Some(&absent), true).await;
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().mcp_servers,
            vec![server.clone()]
        );

        // Null is next to absent, not an empty declaration.
        let null = json!({"sessionId": sid, "cwd": "/w", "mcpServers": null});
        handle_session_resume(&sessions, json!(3), Some(&null), true).await;
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().mcp_servers,
            vec![server.clone()]
        );

        // An explicit [] is a full re-declaration offering none → cleared.
        let empty = json!({"sessionId": sid, "cwd": "/w", "mcpServers": []});
        handle_session_resume(&sessions, json!(4), Some(&empty), true).await;
        assert!(sessions
            .lock()
            .await
            .get(&sid)
            .unwrap()
            .mcp_servers
            .is_empty());
    }

    #[tokio::test]
    async fn resume_with_gate_disabled_stores_nothing() {
        let sessions = new_sessions();
        let sid = format!("sess_{}", Uuid::new_v4());
        let p = json!({
            "sessionId": sid,
            "cwd": "/w",
            "mcpServers": [{"type": "http", "name": "creds", "url": "https://x/mcp"}]
        });
        handle_session_resume(&sessions, json!(1), Some(&p), false).await;
        assert!(sessions
            .lock()
            .await
            .get(&sid)
            .unwrap()
            .mcp_servers
            .is_empty());
    }

    #[test]
    fn parse_session_meta_keeps_objects_verbatim_and_caps_size() {
        let meta = json!({"systemPrompt": "be terse", "nested": {"k": [1, 2]}});
        let params = json!({"cwd": "/w", "mcpServers": [], "_meta": meta});
        assert_eq!(parse_session_meta(Some(&params)), Some(meta));
        assert_eq!(parse_session_meta(Some(&json!({"cwd": "/w"}))), None);
        assert_eq!(parse_session_meta(Some(&json!({"_meta": null}))), None);
        assert_eq!(parse_session_meta(Some(&json!({"_meta": "str"}))), None);
        assert_eq!(parse_session_meta(Some(&json!({"_meta": [1]}))), None);
        assert_eq!(parse_session_meta(None), None);

        // Oversized objects are dropped, not truncated.
        let big = json!({"systemPrompt": "x".repeat(MAX_SESSION_META_BYTES + 1)});
        assert_eq!(parse_session_meta(Some(&json!({"_meta": big}))), None);
        let fits = json!({"systemPrompt": "x".repeat(MAX_SESSION_META_BYTES - 64)});
        assert_eq!(
            parse_session_meta(Some(&json!({"_meta": fits}))),
            Some(fits)
        );
    }

    #[tokio::test]
    async fn session_new_stores_session_meta_on_the_session() {
        let sessions = new_sessions();
        let meta = json!({"systemPrompt": "be terse"});
        let v = serde_json::to_value(
            handle_session_new(&sessions, json!(2), Vec::new(), Some(meta.clone()))
                .await
                .0,
        )
        .unwrap();
        let sid = v["result"]["sessionId"].as_str().unwrap().to_string();
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().session_meta,
            Some(meta)
        );
    }

    #[tokio::test]
    async fn resume_absent_meta_keeps_stored_and_present_replaces() {
        let sessions = new_sessions();
        let meta = json!({"systemPrompt": "v1"});
        let v = serde_json::to_value(
            handle_session_new(&sessions, json!(1), Vec::new(), Some(meta.clone()))
                .await
                .0,
        )
        .unwrap();
        let sid = v["result"]["sessionId"].as_str().unwrap().to_string();

        // Omitted _meta: the client said nothing → the stored object survives.
        let absent = json!({"sessionId": sid, "cwd": "/w"});
        handle_session_resume(&sessions, json!(2), Some(&absent), true).await;
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().session_meta,
            Some(meta.clone())
        );

        // Null / non-object is next to absent, not a replacement.
        let null = json!({"sessionId": sid, "cwd": "/w", "_meta": null});
        handle_session_resume(&sessions, json!(3), Some(&null), true).await;
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().session_meta,
            Some(meta.clone())
        );

        // An oversized object is dropped, which is not a withdrawal either.
        let big = json!({"sessionId": sid, "cwd": "/w", "_meta": {"systemPrompt": "x".repeat(MAX_SESSION_META_BYTES + 1)}});
        handle_session_resume(&sessions, json!(4), Some(&big), true).await;
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().session_meta,
            Some(meta.clone())
        );

        // A present object replaces the stored one (an empty {} included).
        let v2 = json!({"systemPrompt": "v2"});
        let present = json!({"sessionId": sid, "cwd": "/w", "_meta": v2});
        handle_session_resume(&sessions, json!(5), Some(&present), true).await;
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().session_meta,
            Some(v2)
        );
        let empty = json!({"sessionId": sid, "cwd": "/w", "_meta": {}});
        handle_session_resume(&sessions, json!(6), Some(&empty), true).await;
        assert_eq!(
            sessions.lock().await.get(&sid).unwrap().session_meta,
            Some(json!({}))
        );
    }

    #[tokio::test]
    async fn prompt_meta_refreshes_the_live_session_passthrough() {
        let sessions = new_sessions();
        let stale = json!({"dev.openab/credentials": {"NUPHOS_TOKEN": "old"}});
        let v = serde_json::to_value(
            handle_session_new(&sessions, json!(1), Vec::new(), Some(stale.clone()))
                .await
                .0,
        )
        .unwrap();
        let sid = v["result"]["sessionId"].as_str().unwrap().to_string();
        let mut guard = sessions.lock().await;
        let session = guard.get_mut(&sid).unwrap();

        refresh_session_passthrough(session, Some(&json!({"sessionId": sid, "prompt": []})));
        refresh_session_passthrough(
            session,
            Some(&json!({"_meta": {"dev.openab/sessionMeta": null, "dev.openab/mcpServers": {}}})),
        );
        assert_eq!(session.session_meta, Some(stale.clone()));
        assert!(session.mcp_servers.is_empty());

        let too_big = json!({"x": "y".repeat(MAX_SESSION_META_BYTES + 1)});
        refresh_session_passthrough(
            session,
            Some(&json!({"_meta": {"dev.openab/sessionMeta": too_big}})),
        );
        assert_eq!(session.session_meta, Some(stale));

        let fresh = json!({"dev.openab/credentials": {"NUPHOS_TOKEN": "new"}});
        let http = json!({"type": "http", "name": "tools", "url": "http://b/mcp", "headers": [
            {"name": "Authorization", "value": "Bearer new"}
        ]});
        refresh_session_passthrough(
            session,
            Some(&json!({"_meta": {
                "ai.nuphos/acknowledgePrompt": true,
                "dev.openab/sessionMeta": fresh,
                "dev.openab/mcpServers": [http, {"type": "stdio", "name": "x", "command": "sh"}],
            }})),
        );
        assert_eq!(session.session_meta, Some(fresh));
        assert_eq!(session.mcp_servers, vec![http]);
    }

    #[tokio::test]
    async fn resume_with_gate_disabled_stores_no_meta() {
        let sessions = new_sessions();
        let sid = format!("sess_{}", Uuid::new_v4());
        let p = json!({"sessionId": sid, "cwd": "/w", "_meta": {"systemPrompt": "x"}});
        handle_session_resume(&sessions, json!(1), Some(&p), false).await;
        assert_eq!(sessions.lock().await.get(&sid).unwrap().session_meta, None);
    }

    #[test]
    fn initialize_advertises_http_only_when_gated_on() {
        let v = serde_json::to_value(handle_initialize(
            &init_req(Some(json!({"protocolVersion": 1}))),
            true,
        ))
        .unwrap();
        let mcp = &v["result"]["agentCapabilities"]["mcpCapabilities"];
        assert_eq!(mcp["http"], json!(true));
        assert_eq!(
            mcp["sse"],
            json!(false),
            "sse declarations are still dropped"
        );
    }

    #[tokio::test]
    async fn session_resume_valid_stores_and_invalid_errors() {
        let sessions = new_sessions();
        // valid sess_<uuid> → {} and the session is (re)stored
        let sid = format!("sess_{}", Uuid::new_v4());
        let params = json!({"sessionId": sid, "cwd": "/w", "mcpServers": []});
        let v = serde_json::to_value(
            handle_session_resume(&sessions, json!(3), Some(&params), false)
                .await
                .0,
        )
        .unwrap();
        assert_eq!(v["result"], json!({}));
        assert!(sessions.lock().await.contains_key(&sid));
        // malformed sessionId shape → -32602
        let bad = json!({"sessionId": "not-a-session", "cwd": "/w", "mcpServers": []});
        let v = serde_json::to_value(
            handle_session_resume(&sessions, json!(4), Some(&bad), false)
                .await
                .0,
        )
        .unwrap();
        assert_eq!(v["error"]["code"], json!(-32602));
        // missing sessionId → -32602
        let v = serde_json::to_value(
            handle_session_resume(&sessions, json!(5), Some(&json!({"cwd": "/w"})), false)
                .await
                .0,
        )
        .unwrap();
        assert_eq!(v["error"]["code"], json!(-32602));
    }
}

// ---------------------------------------------------------------------------
// Group-review fixes (M1 resume cap / M2 stale-reply fence / subprotocol charset).
// ---------------------------------------------------------------------------
#[cfg(test)]
mod acp_review_fixes {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Arc;
    use uuid::Uuid;

    fn sessions_map() -> Arc<tokio::sync::Mutex<HashMap<String, AcpSession>>> {
        Arc::new(tokio::sync::Mutex::new(HashMap::new()))
    }

    // M1 — session/resume enforces the same per-connection cap as session/new, so a
    // client cannot grow the map without bound by resuming arbitrary `sess_<uuid>`.
    #[tokio::test]
    async fn resume_enforces_session_cap() {
        let sessions = sessions_map();
        let mut ids = Vec::new();
        for _ in 0..MAX_SESSIONS_PER_CONNECTION {
            let sid = format!("sess_{}", Uuid::new_v4());
            let p = json!({ "sessionId": sid });
            let v = serde_json::to_value(
                handle_session_resume(&sessions, json!(1), Some(&p), false)
                    .await
                    .0,
            )
            .unwrap();
            assert_eq!(v["result"], json!({}), "resume under cap should succeed");
            ids.push(sid);
        }
        assert_eq!(sessions.lock().await.len(), MAX_SESSIONS_PER_CONNECTION);
        // A new distinct session over the cap is refused with ACP_OVERLOADED.
        let over = json!({ "sessionId": format!("sess_{}", Uuid::new_v4()) });
        let v = serde_json::to_value(
            handle_session_resume(&sessions, json!(2), Some(&over), false)
                .await
                .0,
        )
        .unwrap();
        assert_eq!(
            v["error"]["code"],
            json!(ACP_OVERLOADED),
            "over-cap resume must be refused"
        );
        // Re-resuming an already-present session is exempt (idempotent).
        let existing = json!({ "sessionId": ids[0] });
        let v = serde_json::to_value(
            handle_session_resume(&sessions, json!(3), Some(&existing), false)
                .await
                .0,
        )
        .unwrap();
        assert_eq!(
            v["result"],
            json!({}),
            "re-resume of existing session must bypass the cap"
        );
    }

    // --- R3-F1: declaration fan-out is bounded before it costs anything ---

    fn decl(id: &str, name: &str) -> super::AcpMcpServer {
        super::AcpMcpServer {
            id: id.into(),
            name: name.into(),
        }
    }

    /// Each declaration buys a task, a pending `mcp/connect` holding a 30s timeout, and an
    /// outbound frame. Declarations are small enough that thousands fit inside one accepted frame,
    /// so the count is capped before the session exists or any task is spawned.
    #[test]
    fn declaration_fan_out_is_capped_and_deduplicated() {
        let cap = super::MAX_ACP_SERVERS_PER_SESSION;

        // At the cap is fine; one past it refuses the whole request.
        let at_cap: Vec<_> = (0..cap).map(|i| decl(&format!("id{i}"), "s")).collect();
        assert_eq!(super::accept_acp_servers(at_cap).unwrap().len(), cap);

        let over: Vec<_> = (0..cap + 1).map(|i| decl(&format!("id{i}"), "s")).collect();
        let err = super::accept_acp_servers(over)
            .expect_err("declaring past the cap must be refused outright");
        assert!(err.contains("Too many type:acp servers"), "{err}");

        // A burst of thousands — the shape the finding describes — is refused rather than
        // truncated: truncating would silently honour part of a request the client cannot know
        // was clipped.
        let flood: Vec<_> = (0..5000).map(|i| decl(&format!("id{i}"), "s")).collect();
        assert!(super::accept_acp_servers(flood).is_err());

        // Duplicate ids collapse to the first, so a repeated id cannot spawn two tunnels racing
        // for one registry key. Dedup runs before the cap, so repeats are not a way to trip it.
        let dupes = vec![
            decl("same", "browser"),
            decl("same", "browser"),
            decl("other", "notes"),
        ];
        let kept = super::accept_acp_servers(dupes).unwrap();
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].id, "same");
        assert_eq!(kept[1].id, "other");

        let many_dupes: Vec<_> = (0..5000).map(|_| decl("same", "browser")).collect();
        assert_eq!(
            super::accept_acp_servers(many_dupes).unwrap().len(),
            1,
            "repeats of one id are one server, not a cap violation"
        );
    }

    /// The accepted list is exactly what gets spawned: one task per unique declaration, no more.
    #[tokio::test]
    async fn only_accepted_declarations_spawn_tunnels() {
        let registry = super::new_tunnel_registry();
        // Built inline: this module has its own helpers and does not share acp_requests'.
        let pending: Arc<
            tokio::sync::Mutex<HashMap<u64, tokio::sync::oneshot::Sender<serde_json::Value>>>,
        > = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let next_id = Arc::new(std::sync::atomic::AtomicU64::new(1));
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let mut tasks: Vec<tokio::task::JoinHandle<()>> = Vec::new();

        let accepted = super::accept_acp_servers(vec![
            decl("a", "browser"),
            decl("a", "browser"), // duplicate — must not spawn twice
            decl("b", "notes"),
        ])
        .unwrap();
        super::spawn_acp_tunnels(
            accepted,
            "acp_abc".into(),
            registry,
            &out_tx,
            &pending,
            &next_id,
            &mut tasks,
            "conn-test",
            0,
            &Arc::new(std::sync::atomic::AtomicBool::new(false)),
        );

        assert_eq!(tasks.len(), 2, "one task per unique declaration");
        // Exactly two mcp/connect frames go out, for the two distinct ids.
        let mut ids = Vec::new();
        for _ in 0..2 {
            let f: serde_json::Value = serde_json::from_str(&out_rx.recv().await.unwrap()).unwrap();
            assert_eq!(f["method"], json!("mcp/connect"));
            ids.push(f["params"]["acpId"].as_str().unwrap().to_string());
        }
        ids.sort();
        assert_eq!(ids, ["a", "b"]);
        assert!(out_rx.try_recv().is_err(), "no excess mcp/connect was sent");
        for t in tasks {
            t.abort();
        }
    }

    // --- F2: the 8 MiB allowance is for tunnel results only ---

    /// The raise to 8 MiB was for browser tool results, which arrive as client RESPONSES
    /// (`id`, no `method`). Frames carrying a method — `session/prompt` above all — stay at the
    /// pre-existing 1 MiB, so the allowance cannot be used to park
    /// MAX_INFLIGHT_PROMPTS × 8 MiB of prompt text on one connection.
    #[test]
    fn only_tunnel_results_may_use_the_larger_frame_allowance() {
        let over_1mib = super::MAX_NON_TUNNEL_FRAME_BYTES + 1;
        let big_result = 8 * 1024 * 1024; // within MAX_FRAME_BYTES

        // A client response (no `method`) may be large — this is the screenshot path.
        let response = json!({ "jsonrpc": "2.0", "id": 7, "result": { "content": [] } });
        assert!(
            super::oversized_for_its_kind(big_result, &response).is_none(),
            "an 8 MiB tunnel result must still be accepted — that is what the raise is for"
        );

        // A prompt of the same size must not be.
        let prompt = json!({ "jsonrpc": "2.0", "id": 1, "method": "session/prompt" });
        assert_eq!(
            super::oversized_for_its_kind(over_1mib, &prompt),
            Some("session/prompt"),
            "a >1 MiB prompt must be rejected"
        );
        assert!(
            super::oversized_for_its_kind(super::MAX_NON_TUNNEL_FRAME_BYTES, &prompt).is_none(),
            "exactly 1 MiB is still allowed — the bound is inclusive"
        );

        // Notifications are method-bearing too, so they are bounded as well (the caller must
        // drop them silently rather than answer).
        let notification = json!({ "jsonrpc": "2.0", "method": "session/cancel" });
        assert_eq!(
            super::oversized_for_its_kind(over_1mib, &notification),
            Some("session/cancel")
        );
    }

    /// A rejected `session/resume` must not become permission to open tunnels.
    ///
    /// The read loop spawns tunnels only when the handler hands back a channel. Deriving one from
    /// the requested `sessionId` — which is what the loop used to do — is not a sufficient guard,
    /// because a perfectly well-formed `sess_<uuid>` derives fine on every rejection path. Combined
    /// with last-write-wins same-name re-attach, that let a refused resume evict the live tunnel it
    /// was refused in favour of, so each rejection is checked for a `None` channel here.
    #[tokio::test]
    async fn a_rejected_resume_yields_no_channel_to_open_tunnels_with() {
        let sessions = sessions_map();

        // 1. missing sessionId
        let (resp, chan) =
            handle_session_resume(&sessions, json!(1), Some(&json!({"cwd": "/w"})), false).await;
        assert_eq!(
            serde_json::to_value(resp).unwrap()["error"]["code"],
            json!(-32602)
        );
        assert!(chan.is_none(), "missing sessionId must not yield a channel");

        // 2. malformed sessionId
        let bad = json!({"sessionId": "not-a-session", "cwd": "/w"});
        let (resp, chan) = handle_session_resume(&sessions, json!(2), Some(&bad), false).await;
        assert_eq!(
            serde_json::to_value(resp).unwrap()["error"]["code"],
            json!(-32602)
        );
        assert!(
            chan.is_none(),
            "malformed sessionId must not yield a channel"
        );

        // 3. over the per-connection cap — note the id IS well formed, so the old
        //    derive-from-params guard would have happily produced a channel here.
        for _ in 0..MAX_SESSIONS_PER_CONNECTION {
            let p = json!({ "sessionId": format!("sess_{}", Uuid::new_v4()) });
            let (_r, chan) = handle_session_resume(&sessions, json!(3), Some(&p), false).await;
            assert!(chan.is_some(), "resume under the cap should succeed");
        }
        let over = json!({ "sessionId": format!("sess_{}", Uuid::new_v4()) });
        let (resp, chan) = handle_session_resume(&sessions, json!(4), Some(&over), false).await;
        assert_eq!(
            serde_json::to_value(resp).unwrap()["error"]["code"],
            json!(ACP_OVERLOADED)
        );
        assert!(
            chan.is_none(),
            "an over-cap resume must not yield a channel"
        );

        // 4. busy — likewise a well-formed id on a session that really exists.
        let busy_sid = format!("sess_{}", Uuid::new_v4());
        sessions.lock().await.insert(
            busy_sid.clone(),
            AcpSession {
                channel_id: derive_channel_id(&busy_sid).unwrap(),
                busy: true,
                cancel: Some(Arc::new(tokio::sync::Notify::new())),
                mcp_servers: Vec::new(),
                session_meta: None,
                permission_relay: None,
            },
        );
        let (resp, chan) = handle_session_resume(
            &sessions,
            json!(5),
            Some(&json!({"sessionId": busy_sid})),
            false,
        )
        .await;
        assert_eq!(
            serde_json::to_value(resp).unwrap()["error"]["code"],
            json!(-32001)
        );
        assert!(
            chan.is_none(),
            "a busy-rejected resume must not yield a channel"
        );
    }

    fn reply(channel_id: &str, reply_to: &str, text: &str, command: Option<&str>) -> GatewayReply {
        GatewayReply {
            schema: "openab.gateway.reply.v1".into(),
            reply_to: reply_to.into(),
            platform: "acp".into(),
            channel: crate::schema::ReplyChannel {
                id: channel_id.into(),
                thread_id: None,
            },
            content: crate::schema::Content {
                content_type: "text".into(),
                text: text.into(),
                attachments: Vec::new(),
            },
            command: command.map(|c| c.into()),
            request_id: None,
            quote_message_id: None,
        }
    }

    #[tokio::test]
    async fn agent_failure_returns_rpc_error_and_releases_the_session() {
        for cause in [
            "ENOSPC: no space left on device",
            "Agent exceeded hard timeout (1800s)",
        ] {
            let (event_tx, mut event_rx) = tokio::sync::broadcast::channel::<String>(16);
            let mut st = crate::AppState::test_default(event_tx);
            let registry = new_reply_registry();
            st.acp_reply_registry = Some(registry.clone());
            let state = Arc::new(st);
            let sessions = sessions_map();
            let (created, _) = handle_session_new(&sessions, json!(1), Vec::new(), None).await;
            let sid = serde_json::to_value(created).unwrap()["result"]["sessionId"]
                .as_str()
                .unwrap()
                .to_string();
            let channel = derive_channel_id(&sid).unwrap();
            // A subsequent prompt on the same session must work after the failure.
            for fail in [true, false] {
                let cancel = Arc::new(tokio::sync::Notify::new());
                {
                    let mut map = sessions.lock().await;
                    let session = map.get_mut(&sid).unwrap();
                    assert!(!session.busy);
                    session.busy = true;
                    session.cancel = Some(cancel.clone());
                }
                let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
                let params = json!({"sessionId": sid, "prompt": [{"type":"text","text":"work"}]});
                let drive = async {
                    let event: Value =
                        serde_json::from_str(&event_rx.recv().await.unwrap()).unwrap();
                    let origin = event["event_id"].as_str().unwrap();
                    handle_reply(
                        &reply(&channel, "evt_stale", "wrong error", Some("agent_error")),
                        &registry,
                    )
                    .await;
                    handle_reply(
                        &reply(&channel, origin, "Partial work", Some("edit_message")),
                        &registry,
                    )
                    .await;
                    handle_reply(
                        &reply(
                            &channel,
                            origin,
                            if fail { cause } else { "Partial work" },
                            Some(if fail { "agent_error" } else { "send_message" }),
                        ),
                        &registry,
                    )
                    .await;
                };
                tokio::join!(
                    handle_session_prompt(
                        &state,
                        &sessions,
                        json!(7),
                        Some(&params),
                        &out_tx,
                        sid.clone(),
                        cancel,
                        "conn-test",
                        0
                    ),
                    drive,
                );
                let partial: Value = serde_json::from_str(&out_rx.try_recv().unwrap()).unwrap();
                assert_eq!(
                    partial["params"]["update"]["content"]["text"],
                    json!("Partial work")
                );
                let result: Value = serde_json::from_str(&out_rx.try_recv().unwrap()).unwrap();
                assert_eq!(result["id"], json!(7));
                if fail {
                    assert_eq!(result["error"]["message"], json!(cause));
                    assert!(result.get("result").is_none());
                } else {
                    assert_eq!(result["result"]["stopReason"], json!("end_turn"));
                }
                let map = sessions.lock().await;
                assert!(!map[&sid].busy);
                assert!(map[&sid].cancel.is_none());
            }
        }
    }

    // M2 — a late reply carrying a superseded turn's event id is dropped, not delivered
    // into the current turn's stream; a reply matching the active turn is delivered.
    #[tokio::test]
    async fn handle_reply_fences_stale_turn() {
        let registry = new_reply_registry();
        let (tx, mut rx) = mpsc::unbounded_channel::<ReplyChunk>();
        registry.lock().unwrap().insert(
            "acp_chan".into(),
            ReplySink {
                turn_id: Some("evt_current".into()),
                tx: Some(tx),
                session_id: "sess_chan".into(),
                out_tx: mpsc::unbounded_channel().0,
                owner: "conn-test".into(),
                generation: 0,
                permission_relay: None,
            },
        );

        // Stale reply (previous turn's event id) → dropped.
        assert!(
            handle_reply(
                &reply("acp_chan", "evt_stale", "leaked", Some("agent_update")),
                &registry,
            )
            .await
            .is_none(),
            "a rejected event cannot authorize continuation observation"
        );
        assert!(
            rx.try_recv().is_err(),
            "stale reply must not reach the active turn"
        );

        // Matching reply → delivered.
        handle_reply(
            &reply("acp_chan", "evt_current", "hello", Some("edit_message")),
            &registry,
        )
        .await;
        match rx.try_recv() {
            Ok(ReplyChunk::Text(t)) => assert_eq!(t, "hello"),
            _ => panic!("expected the matching reply to be delivered"),
        }
    }

    #[tokio::test]
    async fn handle_reply_forwards_agent_update_between_prompts() {
        let registry = new_reply_registry();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        registry.lock().unwrap().insert(
            "acp_chan".into(),
            ReplySink {
                turn_id: None,
                tx: None,
                session_id: "sess_chan".into(),
                out_tx,
                owner: "conn-test".into(),
                generation: 0,
                permission_relay: None,
            },
        );
        let update = json!({
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "timer fired"}
        });

        handle_reply(
            &reply(
                "acp_chan",
                "evt_previous",
                &update.to_string(),
                Some("agent_update"),
            ),
            &registry,
        )
        .await;

        let frame: serde_json::Value =
            serde_json::from_str(&out_rx.try_recv().expect("session update")).unwrap();
        assert_eq!(frame["method"], json!("session/update"));
        assert_eq!(frame["params"]["sessionId"], json!("sess_chan"));
        assert_eq!(frame["params"]["update"], update);
    }

    #[tokio::test]
    async fn terminal_reply_preserves_the_session_sink_for_idle_updates() {
        let registry = new_reply_registry();
        let (turn_tx, mut turn_rx) = mpsc::unbounded_channel::<ReplyChunk>();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        registry.lock().unwrap().insert(
            "acp_chan".into(),
            ReplySink {
                turn_id: Some("evt_current".into()),
                tx: Some(turn_tx),
                session_id: "sess_chan".into(),
                out_tx,
                owner: "conn-test".into(),
                generation: 0,
                permission_relay: None,
            },
        );

        handle_reply(
            &reply("acp_chan", "evt_current", "done", Some("send_message")),
            &registry,
        )
        .await;

        assert!(matches!(turn_rx.try_recv(), Ok(ReplyChunk::Text(text)) if text == "done"));
        assert!(matches!(turn_rx.try_recv(), Ok(ReplyChunk::Done(None))));
        {
            let map = registry.lock().unwrap();
            let sink = map
                .get("acp_chan")
                .expect("terminal reply must preserve the connection-level sink");
            assert!(sink.turn_id.is_none());
            assert!(sink.tx.is_none());
        }

        let update = json!({
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "timer fired"}
        });
        handle_reply(
            &reply(
                "acp_chan",
                "evt_current",
                &update.to_string(),
                Some("agent_update"),
            ),
            &registry,
        )
        .await;

        let frame: serde_json::Value =
            serde_json::from_str(&out_rx.try_recv().expect("idle session update")).unwrap();
        assert_eq!(frame["method"], json!("session/update"));
        assert_eq!(frame["params"]["sessionId"], json!("sess_chan"));
        assert_eq!(frame["params"]["update"], update);
    }

    // F4 — two connections on one session race on the process-wide reply registry (session busy is
    // per-connection). The active turn wins regardless of connection age; after it becomes idle,
    // another connection may take the next turn without a stale completion removing that new sink.
    #[test]
    fn neither_connection_clobbers_the_others_reply_sink() {
        let registry = new_reply_registry();
        let idle_sink = |owner: &str, generation: u64| super::ReplySink {
            turn_id: None,
            tx: None,
            session_id: "sess_x".into(),
            out_tx: mpsc::unbounded_channel().0,
            owner: owner.into(),
            generation,
            permission_relay: None,
        };
        let activate = |turn: &str, owner: &str, generation: u64| {
            let (tx, _rx) = mpsc::unbounded_channel::<ReplyChunk>();
            super::activate_reply_sink(
                &registry,
                "acp_x",
                super::ReplySink {
                    turn_id: Some(turn.into()),
                    tx: Some(tx),
                    session_id: "sess_x".into(),
                    out_tx: mpsc::unbounded_channel().0,
                    owner: owner.into(),
                    generation,
                    permission_relay: None,
                },
            )
        };
        let current_turn = || {
            registry
                .lock()
                .unwrap()
                .get("acp_x")
                .and_then(|s| s.turn_id.clone())
        };

        assert!(activate("evt_a", "conn-A", 1));
        assert!(
            !super::install_reply_sink(&registry, "acp_x", idle_sink("conn-B", 2)),
            "a resume cannot replace an active turn"
        );
        assert!(!activate("evt_b", "conn-B", 2));
        assert_eq!(current_turn().as_deref(), Some("evt_a"));

        super::remove_reply_sink_if_owner(&registry, "acp_x", "evt_a");
        assert!(super::install_reply_sink(
            &registry,
            "acp_x",
            idle_sink("conn-B", 2)
        ));
        assert!(activate("evt_b", "conn-B", 2));

        super::remove_reply_sink_if_owner(&registry, "acp_x", "evt_a");
        assert_eq!(
            current_turn().as_deref(),
            Some("evt_b"),
            "A's stale completion cannot remove B"
        );
        super::remove_reply_sink_if_owner(&registry, "acp_x", "evt_b");
        assert!(
            current_turn().is_none(),
            "the owner's completion deactivates its own sink"
        );
    }

    #[test]
    fn an_idle_sink_can_be_claimed_by_an_older_live_connection() {
        let registry = new_reply_registry();
        let (idle_out_tx, mut idle_out_rx) = mpsc::unbounded_channel::<String>();
        assert!(super::install_reply_sink(
            &registry,
            "acp_x",
            super::ReplySink {
                turn_id: None,
                tx: None,
                session_id: "sess_x".into(),
                out_tx: idle_out_tx,
                owner: "conn-B".into(),
                generation: 2,
                permission_relay: None,
            },
        ));

        let (turn_tx, _turn_rx) = mpsc::unbounded_channel::<ReplyChunk>();
        let (prompt_out_tx, mut prompt_out_rx) = mpsc::unbounded_channel::<String>();
        let prompt_permission_relay = ClientRequestHandle {
            out_tx: prompt_out_tx.clone(),
            pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
        };
        assert!(
            super::activate_reply_sink(
                &registry,
                "acp_x",
                super::ReplySink {
                    turn_id: Some("evt_a".into()),
                    tx: Some(turn_tx),
                    session_id: "sess_x".into(),
                    out_tx: prompt_out_tx,
                    owner: "conn-A".into(),
                    generation: 1,
                    permission_relay: Some(prompt_permission_relay),
                },
            ),
            "an idle route is not a permanent ownership lease"
        );

        let map = registry.lock().unwrap();
        let sink = map.get("acp_x").unwrap();
        assert_eq!(sink.turn_id.as_deref(), Some("evt_a"));
        assert_eq!(sink.owner, "conn-A");
        assert_eq!(sink.generation, 1);
        let relay_out = sink.permission_relay.as_ref().unwrap().out_tx.clone();
        drop(map);

        relay_out.send("relay-probe".into()).unwrap();
        assert_eq!(prompt_out_rx.try_recv().unwrap(), "relay-probe");
        assert!(
            idle_out_rx.try_recv().is_err(),
            "the claimed turn must not retain the previous replica's permission path"
        );
    }

    #[test]
    fn an_active_sink_cannot_be_stolen_by_a_newer_connection() {
        let registry = new_reply_registry();
        let (active_tx, _active_rx) = mpsc::unbounded_channel::<ReplyChunk>();
        let (active_out_tx, _active_out_rx) = mpsc::unbounded_channel::<String>();
        assert!(super::activate_reply_sink(
            &registry,
            "acp_x",
            super::ReplySink {
                turn_id: Some("evt_a".into()),
                tx: Some(active_tx),
                session_id: "sess_x".into(),
                out_tx: active_out_tx,
                owner: "conn-A".into(),
                generation: 1,
                permission_relay: None,
            },
        ));

        let (competing_tx, _competing_rx) = mpsc::unbounded_channel::<ReplyChunk>();
        let (competing_out_tx, _competing_out_rx) = mpsc::unbounded_channel::<String>();
        assert!(
            !super::activate_reply_sink(
                &registry,
                "acp_x",
                super::ReplySink {
                    turn_id: Some("evt_b".into()),
                    tx: Some(competing_tx),
                    session_id: "sess_x".into(),
                    out_tx: competing_out_tx,
                    owner: "conn-B".into(),
                    generation: 2,
                    permission_relay: None,
                },
            ),
            "a newer connection must wait until the active turn releases ownership"
        );

        let map = registry.lock().unwrap();
        let sink = map.get("acp_x").unwrap();
        assert_eq!(sink.turn_id.as_deref(), Some("evt_a"));
        assert_eq!(sink.owner, "conn-A");
    }

    // F4 — after the same connection finishes one turn, its next turn claims the idle sink; a
    // duplicate stale completion must not then remove the live new one.
    #[test]
    fn a_connections_new_turn_replaces_its_own_sink_without_the_old_turn_removing_it() {
        let registry = new_reply_registry();
        let activate = |turn: &str| {
            let (tx, _rx) = mpsc::unbounded_channel::<ReplyChunk>();
            super::activate_reply_sink(
                &registry,
                "acp_x",
                super::ReplySink {
                    turn_id: Some(turn.into()),
                    tx: Some(tx),
                    session_id: "sess_x".into(),
                    out_tx: mpsc::unbounded_channel().0,
                    owner: "conn-A".into(),
                    generation: 5,
                    permission_relay: None,
                },
            )
        };
        assert!(activate("evt_1"));
        super::remove_reply_sink_if_owner(&registry, "acp_x", "evt_1");
        assert!(activate("evt_2"));
        // Stale turn 1's completion must not remove turn 2's sink.
        super::remove_reply_sink_if_owner(&registry, "acp_x", "evt_1");
        assert_eq!(
            registry
                .lock()
                .unwrap()
                .get("acp_x")
                .and_then(|s| s.turn_id.clone())
                .as_deref(),
            Some("evt_2"),
            "the stale turn must not remove the same connection's newer sink"
        );
    }

    // R17-F1 — keyless-mode browser `Origin` gating. A WS handshake bypasses the browser
    // same-origin policy, so on a keyless loopback bind an un-allowlisted browser origin
    // must be refused (ws_upgrade turns `false` into a 403). A non-browser client sends no
    // `Origin` and is always admitted; the keyed path never reaches this check (it lives in
    // the `else` of the bearer branch), so a keyed bind is unaffected by the allowlist.
    #[test]
    fn acp_origin_ok_keyless_gating() {
        let allow = vec![
            "https://app.example".to_string(),
            "http://localhost:5173".to_string(),
        ];
        // Absent Origin (non-browser client) → accept, regardless of allowlist.
        assert!(
            acp_origin_ok(None, &allow),
            "no Origin (non-browser) must be admitted"
        );
        assert!(
            acp_origin_ok(None, &[]),
            "no Origin must be admitted even with empty allowlist"
        );
        // Allowlisted browser Origin → accept (exact match, both entries).
        assert!(acp_origin_ok(Some("https://app.example"), &allow));
        assert!(acp_origin_ok(Some("http://localhost:5173"), &allow));
        // Disallowed browser Origin → reject (→ 403 at the handler).
        assert!(!acp_origin_ok(Some("https://evil.example"), &allow));
        // Default empty allowlist blocks every browser-set Origin.
        assert!(!acp_origin_ok(Some("https://app.example"), &[]));
        // Match is exact — no scheme/host/port fuzzing, no trailing-slash leniency.
        assert!(!acp_origin_ok(Some("https://app.example/"), &allow));
        assert!(!acp_origin_ok(Some("http://app.example"), &allow));
    }

    // R17-F2 — the legacy `?token=` query fallback is gone. The bearer is extracted ONLY
    // from `Authorization: Bearer` or the `Sec-WebSocket-Protocol` subprotocol; `ws_upgrade`
    // no longer reads the query string. A request whose only credential would have been
    // `?token=<key>` now carries no header-borne token, so extraction yields None → keyed
    // mode rejects it 401 (the query is never consulted).
    #[test]
    fn ws_bearer_token_ignores_query_only_request() {
        use axum::http::HeaderMap;
        // No Authorization, no subprotocol → what used to be a `?token=` request now has no
        // extractable bearer (None → 401 in keyed mode).
        assert_eq!(ws_bearer_token(&HeaderMap::new()), None);
        // Authorization: Bearer still carries the key.
        let mut h = HeaderMap::new();
        h.insert("authorization", "Bearer sekret".parse().unwrap());
        assert_eq!(ws_bearer_token(&h), Some("sekret"));
        // The subprotocol path still carries the key.
        let mut h = HeaderMap::new();
        h.insert(
            "sec-websocket-protocol",
            "openab.bearer.sekret, acp.v1".parse().unwrap(),
        );
        assert_eq!(ws_bearer_token(&h), Some("sekret"));
    }

    // subprotocol charset (n1) — base64 `/` and `=` are not RFC 6455 token chars; the
    // recommended `[A-Za-z0-9._~+-]` set (plus other tchars) is.
    #[test]
    fn ws_subprotocol_token_charset() {
        for &b in b"AZaz09._~+-!#$%&'*^`|" {
            assert!(
                is_ws_subprotocol_token_char(b),
                "{} should be token-safe",
                b as char
            );
        }
        for &b in b"=/,; @\"" {
            assert!(
                !is_ws_subprotocol_token_char(b),
                "{} should be rejected",
                b as char
            );
        }
    }

    // R16-F1 — the read loop now reserves the prompt's cancel state SYNCHRONOUSLY (busy + a
    // cancel Notify installed under the session lock) before spawning the handler. So a
    // `session/cancel` arriving before the handler reaches its stream `select!` still cancels
    // the turn: `tokio::Notify` stores one permit, so a pre-fired cancel is consumed by
    // `cancel.notified()` (stopReason "cancelled") rather than lost. Before the fix the cancel
    // installed inside the spawned task, so an immediate cancel read `s.cancel == None`.
    #[tokio::test]
    async fn prompt_cancel_race_before_first_update_cancels() {
        let (event_tx, _event_rx) = tokio::sync::broadcast::channel::<String>(16);
        let mut st = crate::AppState::test_default(event_tx);
        st.acp_reply_registry = Some(new_reply_registry());
        let state = Arc::new(st);

        let sessions = sessions_map();
        let sid = format!("sess_{}", Uuid::new_v4());
        let cancel = Arc::new(tokio::sync::Notify::new());
        sessions.lock().await.insert(
            sid.clone(),
            AcpSession {
                channel_id: format!("acp_{}", Uuid::new_v4()),
                busy: true,
                cancel: Some(cancel.clone()),
                mcp_servers: Vec::new(),
                session_meta: None,
                permission_relay: None,
            },
        );
        // Cancel arrives before the handler's stream loop (reserved-then-immediate-cancel).
        cancel.notify_one();

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let params = json!({"sessionId": sid, "prompt": [{"type": "text", "text": "hi"}]});
        handle_session_prompt(
            &state,
            &sessions,
            json!(7),
            Some(&params),
            &out_tx,
            sid.clone(),
            cancel,
            "conn-test",
            0,
        )
        .await;

        // The final response (matching our request id) must carry stopReason "cancelled".
        let mut final_resp = None;
        while let Ok(s) = out_rx.try_recv() {
            let v: serde_json::Value = serde_json::from_str(&s).unwrap();
            if v.get("id") == Some(&json!(7)) {
                final_resp = Some(v);
            }
        }
        let resp = final_resp.expect("prompt must produce a final response");
        assert_eq!(
            resp["result"]["stopReason"],
            json!("cancelled"),
            "an immediate cancel must cancel the turn, not be dropped"
        );
        // And the reservation is released.
        let g = sessions.lock().await;
        let s = g.get(&sid).unwrap();
        assert!(
            !s.busy && s.cancel.is_none(),
            "cancel must release busy + cancel handle"
        );
    }

    // OPENAB_ACP_MCP_SERVERS passthrough: entries stored at session/new ride every
    // prompt's GatewayEvent as `channel.mcp_servers`, so core can forward them to
    // the inner agent session.
    #[tokio::test]
    async fn prompt_event_carries_the_sessions_stored_http_mcp_servers() {
        let (event_tx, mut event_rx) = tokio::sync::broadcast::channel::<String>(16);
        let mut st = crate::AppState::test_default(event_tx);
        st.acp_reply_registry = Some(new_reply_registry());
        let state = Arc::new(st);

        let sessions = sessions_map();
        let server = json!({
            "name": "nuphos-credentials",
            "type": "http",
            "url": "https://x.example/mcp",
            "headers": [{"name": "Authorization", "value": "Bearer t"}]
        });
        let (resp, _channel) =
            handle_session_new(&sessions, json!(1), vec![server.clone()], None).await;
        let sid = serde_json::to_value(resp).unwrap()["result"]["sessionId"]
            .as_str()
            .unwrap()
            .to_string();

        // Reserve the prompt like the read loop, with the cancel pre-fired so the
        // handler exits right after dispatching the event.
        let cancel = Arc::new(tokio::sync::Notify::new());
        {
            let mut g = sessions.lock().await;
            let s = g.get_mut(&sid).unwrap();
            s.busy = true;
            s.cancel = Some(cancel.clone());
        }
        cancel.notify_one();

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let params = json!({"sessionId": sid, "prompt": [{"type": "text", "text": "hi"}], "_meta":{"ai.nuphos/acknowledgePrompt":true}});
        handle_session_prompt(
            &state,
            &sessions,
            json!(7),
            Some(&params),
            &out_tx,
            sid.clone(),
            cancel,
            "conn-test",
            0,
        )
        .await;

        let acknowledgement: Value = serde_json::from_str(&out_rx.try_recv().unwrap()).unwrap();
        assert_eq!(acknowledgement["method"], "_openab/session/prompt_accepted");
        assert_eq!(acknowledgement["params"]["requestId"], 7);
        assert_eq!(acknowledgement["params"]["sessionId"], sid);
        let event_json = event_rx
            .try_recv()
            .expect("prompt must dispatch a GatewayEvent");
        let event: serde_json::Value = serde_json::from_str(&event_json).unwrap();
        assert_eq!(
            event["channel"]["mcp_servers"],
            json!([server]),
            "the stored http entries must ride the event verbatim"
        );
    }

    // A session declaring nothing serializes no `mcp_servers` key at all (back-compat wire).
    #[tokio::test]
    async fn prompt_event_omits_mcp_servers_when_none_declared() {
        let (event_tx, mut event_rx) = tokio::sync::broadcast::channel::<String>(16);
        let mut st = crate::AppState::test_default(event_tx);
        st.acp_reply_registry = Some(new_reply_registry());
        let state = Arc::new(st);

        let sessions = sessions_map();
        let (resp, _channel) = handle_session_new(&sessions, json!(1), Vec::new(), None).await;
        let sid = serde_json::to_value(resp).unwrap()["result"]["sessionId"]
            .as_str()
            .unwrap()
            .to_string();
        let cancel = Arc::new(tokio::sync::Notify::new());
        {
            let mut g = sessions.lock().await;
            let s = g.get_mut(&sid).unwrap();
            s.busy = true;
            s.cancel = Some(cancel.clone());
        }
        cancel.notify_one();

        let (out_tx, _out_rx) = mpsc::unbounded_channel::<String>();
        let params = json!({"sessionId": sid, "prompt": [{"type": "text", "text": "hi"}]});
        handle_session_prompt(
            &state,
            &sessions,
            json!(7),
            Some(&params),
            &out_tx,
            sid.clone(),
            cancel,
            "conn-test",
            0,
        )
        .await;

        let event_json = event_rx
            .try_recv()
            .expect("prompt must dispatch a GatewayEvent");
        let event: serde_json::Value = serde_json::from_str(&event_json).unwrap();
        assert!(
            event["channel"].get("mcp_servers").is_none(),
            "an empty set must not appear on the wire: {event}"
        );
        assert!(
            event["channel"].get("session_meta").is_none(),
            "an absent _meta must not appear on the wire: {event}"
        );
    }

    // The session `_meta` stored at session/new rides every prompt's GatewayEvent as
    // `channel.session_meta`, so core can forward it to the inner agent session.
    #[tokio::test]
    async fn prompt_event_carries_the_sessions_stored_meta() {
        let (event_tx, mut event_rx) = tokio::sync::broadcast::channel::<String>(16);
        let mut st = crate::AppState::test_default(event_tx);
        st.acp_reply_registry = Some(new_reply_registry());
        let state = Arc::new(st);

        let sessions = sessions_map();
        let meta = json!({"systemPrompt": "be terse", "nested": {"k": [1, 2]}});
        let (resp, _channel) =
            handle_session_new(&sessions, json!(1), Vec::new(), Some(meta.clone())).await;
        let sid = serde_json::to_value(resp).unwrap()["result"]["sessionId"]
            .as_str()
            .unwrap()
            .to_string();
        let cancel = Arc::new(tokio::sync::Notify::new());
        {
            let mut g = sessions.lock().await;
            let s = g.get_mut(&sid).unwrap();
            s.busy = true;
            s.cancel = Some(cancel.clone());
        }
        cancel.notify_one();

        let (out_tx, _out_rx) = mpsc::unbounded_channel::<String>();
        let params = json!({"sessionId": sid, "prompt": [{"type": "text", "text": "hi"}]});
        handle_session_prompt(
            &state,
            &sessions,
            json!(7),
            Some(&params),
            &out_tx,
            sid.clone(),
            cancel,
            "conn-test",
            0,
        )
        .await;

        let event_json = event_rx
            .try_recv()
            .expect("prompt must dispatch a GatewayEvent");
        let event: serde_json::Value = serde_json::from_str(&event_json).unwrap();
        assert_eq!(
            event["channel"]["session_meta"], meta,
            "the stored _meta must ride the event verbatim"
        );
    }

    // R16-F2 — session/resume on a session with a prompt in flight is rejected (busy), so the
    // active turn's cancel handle + state are NOT clobbered by resume's unconditional rewrite.
    #[tokio::test]
    async fn resume_while_busy_is_rejected_and_preserves_state() {
        let sessions = sessions_map();
        let sid = format!("sess_{}", Uuid::new_v4());
        let cancel = Arc::new(tokio::sync::Notify::new());
        sessions.lock().await.insert(
            sid.clone(),
            AcpSession {
                channel_id: format!("acp_{}", Uuid::new_v4()),
                busy: true,
                cancel: Some(cancel.clone()),
                mcp_servers: Vec::new(),
                session_meta: None,
                permission_relay: None,
            },
        );

        let params = json!({"sessionId": sid, "cwd": "/w", "mcpServers": []});
        let (resp, resumed) =
            handle_session_resume(&sessions, json!(9), Some(&params), false).await;
        let v = serde_json::to_value(resp).unwrap();
        assert_eq!(
            v["error"]["code"],
            json!(-32001),
            "resume while busy must be rejected"
        );
        assert!(
            resumed.is_none(),
            "a rejected resume must not hand back a channel — that value is the caller's \
             permission to open tunnels, and same-name re-attach would evict the live one"
        );

        // The in-flight turn's state survives untouched.
        let g = sessions.lock().await;
        let s = g.get(&sid).unwrap();
        assert!(s.busy, "busy must remain set after a rejected resume");
        assert!(
            s.cancel.is_some(),
            "the active prompt's cancel handle must survive resume"
        );
    }

    // R16-F3(A) — Phase-1 send-once: the ACP path streams the whole reply as a SINGLE terminal
    // agent_message_chunk (backend streaming=false), which anchors the ADR/PR doc claim. A final
    // reply (`send_message`) delivers one Text + Done, so exactly one chunk reaches the client.
    #[tokio::test]
    async fn phase1_emits_single_terminal_agent_message_chunk() {
        let (event_tx, _event_rx) = tokio::sync::broadcast::channel::<String>(16);
        let registry = new_reply_registry();
        let mut st = crate::AppState::test_default(event_tx);
        st.acp_reply_registry = Some(registry.clone());
        let state = Arc::new(st);

        let sessions = sessions_map();
        let sid = format!("sess_{}", Uuid::new_v4());
        let channel_id = format!("acp_{}", Uuid::new_v4());
        let cancel = Arc::new(tokio::sync::Notify::new());
        sessions.lock().await.insert(
            sid.clone(),
            AcpSession {
                channel_id: channel_id.clone(),
                busy: true,
                cancel: Some(cancel.clone()),
                mcp_servers: Vec::new(),
                session_meta: None,
                permission_relay: None,
            },
        );

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let st2 = state.clone();
        let sessions2 = sessions.clone();
        let sid2 = sid.clone();
        let handle = tokio::spawn(async move {
            let params = json!({"sessionId": sid2, "prompt": [{"type": "text", "text": "hi"}]});
            handle_session_prompt(
                &st2,
                &sessions2,
                json!(11),
                Some(&params),
                &out_tx,
                sid2.clone(),
                cancel,
                "conn-test",
                0,
            )
            .await;
        });

        // Wait for the handler to register its reply sink, then feed one final reply.
        let mut turn_id = None;
        for _ in 0..10_000 {
            if let Some(t) = registry
                .lock()
                .unwrap()
                .get(&channel_id)
                .and_then(|s| s.turn_id.clone())
            {
                turn_id = Some(t);
                break;
            }
            tokio::task::yield_now().await;
        }
        let turn_id = turn_id.expect("handler must register a reply sink");
        handle_reply(
            &reply(&channel_id, &turn_id, "hello world", Some("send_message")),
            &registry,
        )
        .await;
        handle.await.unwrap();

        let mut chunks = Vec::new();
        let mut final_stop = None;
        while let Ok(s) = out_rx.try_recv() {
            let v: serde_json::Value = serde_json::from_str(&s).unwrap();
            if v["method"] == json!("session/update")
                && v["params"]["update"]["sessionUpdate"] == json!("agent_message_chunk")
            {
                chunks.push(
                    v["params"]["update"]["content"]["text"]
                        .as_str()
                        .unwrap_or("")
                        .to_string(),
                );
            }
            if v.get("id") == Some(&json!(11)) {
                final_stop = v["result"]["stopReason"].as_str().map(str::to_string);
            }
        }
        assert_eq!(
            chunks.len(),
            1,
            "Phase-1 must stream exactly one terminal chunk, got {chunks:?}"
        );
        assert_eq!(chunks[0], "hello world");
        assert_eq!(
            final_stop.as_deref(),
            Some("end_turn"),
            "a completed turn ends end_turn"
        );
    }

    // Streamed `edit_message` snapshots and `agent_update` relays must reach the client
    // in exactly the order handle_reply saw them, and a terminal `send_message` that
    // repeats the last snapshot must diff to nothing (no duplicate tail) while still
    // completing the turn with the session/prompt response.
    #[tokio::test]
    async fn streamed_deltas_interleave_in_order_and_terminal_snapshot_dedupes() {
        let (event_tx, _event_rx) = tokio::sync::broadcast::channel::<String>(16);
        let registry = new_reply_registry();
        let mut st = crate::AppState::test_default(event_tx);
        st.acp_reply_registry = Some(registry.clone());
        let state = Arc::new(st);

        let sessions = sessions_map();
        let sid = format!("sess_{}", Uuid::new_v4());
        let channel_id = format!("acp_{}", Uuid::new_v4());
        let cancel = Arc::new(tokio::sync::Notify::new());
        sessions.lock().await.insert(
            sid.clone(),
            AcpSession {
                channel_id: channel_id.clone(),
                busy: true,
                cancel: Some(cancel.clone()),
                mcp_servers: Vec::new(),
                session_meta: None,
                permission_relay: None,
            },
        );

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let st2 = state.clone();
        let sessions2 = sessions.clone();
        let sid2 = sid.clone();
        let handle = tokio::spawn(async move {
            let params = json!({"sessionId": sid2, "prompt": [{"type": "text", "text": "hi"}]});
            handle_session_prompt(
                &st2,
                &sessions2,
                json!(12),
                Some(&params),
                &out_tx,
                sid2.clone(),
                cancel,
                "conn-test",
                0,
            )
            .await;
        });

        let mut turn_id = None;
        for _ in 0..10_000 {
            if let Some(t) = registry
                .lock()
                .unwrap()
                .get(&channel_id)
                .and_then(|s| s.turn_id.clone())
            {
                turn_id = Some(t);
                break;
            }
            tokio::task::yield_now().await;
        }
        let turn_id = turn_id.expect("handler must register a reply sink");

        // Mid-turn snapshots carry the "draft" placeholder id; updates carry the turn id.
        let tool_call = json!({"sessionUpdate": "tool_call", "toolCallId": "t1", "title": "check", "status": "pending"});
        let thought = json!({"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "hmm"}});
        handle_reply(
            &reply(&channel_id, "draft", "Linode C", Some("edit_message")),
            &registry,
        )
        .await;
        handle_reply(
            &reply(
                &channel_id,
                &turn_id,
                &tool_call.to_string(),
                Some("agent_update"),
            ),
            &registry,
        )
        .await;
        handle_reply(
            &reply(&channel_id, "draft", "Linode CLI ok", Some("edit_message")),
            &registry,
        )
        .await;
        handle_reply(
            &reply(
                &channel_id,
                &turn_id,
                &thought.to_string(),
                Some("agent_update"),
            ),
            &registry,
        )
        .await;
        // Terminal reply repeats the last snapshot verbatim — must emit no new chunk.
        handle_reply(
            &reply(&channel_id, &turn_id, "Linode CLI ok", Some("send_message")),
            &registry,
        )
        .await;
        handle.await.unwrap();

        let mut updates: Vec<(String, String)> = Vec::new();
        let mut final_stop = None;
        while let Ok(s) = out_rx.try_recv() {
            let v: serde_json::Value = serde_json::from_str(&s).unwrap();
            if v["method"] == json!("session/update") {
                let u = &v["params"]["update"];
                updates.push((
                    u["sessionUpdate"].as_str().unwrap_or("").to_string(),
                    u["content"]["text"].as_str().unwrap_or("").to_string(),
                ));
            }
            if v.get("id") == Some(&json!(12)) {
                final_stop = v["result"]["stopReason"].as_str().map(str::to_string);
            }
        }
        let expected = vec![
            ("agent_message_chunk".to_string(), "Linode C".to_string()),
            ("tool_call".to_string(), String::new()),
            ("agent_message_chunk".to_string(), "LI ok".to_string()),
            ("agent_thought_chunk".to_string(), "hmm".to_string()),
        ];
        assert_eq!(
            updates, expected,
            "session updates must preserve arrival order with no duplicate terminal chunk"
        );
        assert_eq!(
            final_stop.as_deref(),
            Some("end_turn"),
            "turn must still complete via the prompt response"
        );
    }

    // Text relayed as `agent_update` chunks is counted, so the terminal reply that repeats
    // the full text emits no duplicate chunk.
    #[tokio::test]
    async fn text_relayed_as_agent_updates_is_not_repeated_by_the_terminal_snapshot() {
        let (event_tx, _event_rx) = tokio::sync::broadcast::channel::<String>(16);
        let registry = new_reply_registry();
        let mut st = crate::AppState::test_default(event_tx);
        st.acp_reply_registry = Some(registry.clone());
        let state = Arc::new(st);

        let sessions = sessions_map();
        let sid = format!("sess_{}", Uuid::new_v4());
        let channel_id = format!("acp_{}", Uuid::new_v4());
        let cancel = Arc::new(tokio::sync::Notify::new());
        sessions.lock().await.insert(
            sid.clone(),
            AcpSession {
                channel_id: channel_id.clone(),
                busy: true,
                cancel: Some(cancel.clone()),
                mcp_servers: Vec::new(),
                session_meta: None,
                permission_relay: None,
            },
        );

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let st2 = state.clone();
        let sessions2 = sessions.clone();
        let sid2 = sid.clone();
        let handle = tokio::spawn(async move {
            let params = json!({"sessionId": sid2, "prompt": [{"type": "text", "text": "hi"}]});
            handle_session_prompt(
                &st2,
                &sessions2,
                json!(13),
                Some(&params),
                &out_tx,
                sid2.clone(),
                cancel,
                "conn-test",
                0,
            )
            .await;
        });

        let mut turn_id = None;
        for _ in 0..10_000 {
            if let Some(t) = registry
                .lock()
                .unwrap()
                .get(&channel_id)
                .and_then(|s| s.turn_id.clone())
            {
                turn_id = Some(t);
                break;
            }
            tokio::task::yield_now().await;
        }
        let turn_id = turn_id.expect("handler must register a reply sink");

        for text in ["Linode C", "LI ok 🎉"] {
            let chunk = json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": text}});
            handle_reply(
                &reply(
                    &channel_id,
                    &turn_id,
                    &chunk.to_string(),
                    Some("agent_update"),
                ),
                &registry,
            )
            .await;
        }
        handle_reply(
            &reply(
                &channel_id,
                &turn_id,
                "Linode CLI ok 🎉",
                Some("send_message"),
            ),
            &registry,
        )
        .await;
        handle.await.unwrap();

        let mut chunks = Vec::new();
        let mut final_stop = None;
        while let Ok(s) = out_rx.try_recv() {
            let v: serde_json::Value = serde_json::from_str(&s).unwrap();
            if v["params"]["update"]["sessionUpdate"] == json!("agent_message_chunk") {
                chunks.push(
                    v["params"]["update"]["content"]["text"]
                        .as_str()
                        .unwrap_or("")
                        .to_string(),
                );
            }
            if v.get("id") == Some(&json!(13)) {
                final_stop = v["result"]["stopReason"].as_str().map(str::to_string);
            }
        }
        assert_eq!(chunks, vec!["Linode C", "LI ok 🎉"]);
        assert_eq!(final_stop.as_deref(), Some("end_turn"));
    }

    // R17-F3c — a request-shaped `session/cancel` (id present) must NOT be acknowledged with
    // an empty success frame. ACP defines cancel as notification-only, so a request form is a
    // protocol violation → -32600 invalid request, and the cancel signal is not fired.
    #[tokio::test]
    async fn cancel_as_request_is_rejected_not_empty_success() {
        let sessions = sessions_map();
        let (event_tx, _event_rx) = tokio::sync::broadcast::channel::<String>(4);
        let params = json!({"sessionId": format!("sess_{}", Uuid::new_v4())});
        let state = Arc::new(crate::AppState::test_default(event_tx.clone()));
        let resp = handle_session_cancel(
            &state,
            &sessions,
            &event_tx,
            json!(42),
            Some(&params),
            false,
        )
        .await
        .expect("a request-shaped cancel must produce a response, not silence");
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(
            v["error"]["code"],
            json!(-32600),
            "request-shaped cancel must be -32600"
        );
        assert_eq!(v["id"], json!(42));
        assert!(
            v.get("result").is_none(),
            "must NOT carry an empty-success result: {v}"
        );
    }

    // The notification is control-plane input. It must reach core without
    // locally completing the outer prompt.
    #[tokio::test]
    async fn cancel_as_notification_only_forwards_to_runtime() {
        let sessions = sessions_map();
        let (event_tx, mut event_rx) = tokio::sync::broadcast::channel::<String>(4);
        let sid = format!("sess_{}", Uuid::new_v4());
        let cancel = Arc::new(tokio::sync::Notify::new());
        sessions.lock().await.insert(
            sid.clone(),
            AcpSession {
                channel_id: format!("acp_{}", Uuid::new_v4()),
                busy: true,
                cancel: Some(cancel.clone()),
                mcp_servers: Vec::new(),
                session_meta: None,
                permission_relay: None,
            },
        );
        let params = json!({"sessionId": sid});
        let state = Arc::new(crate::AppState::test_default(event_tx.clone()));
        let resp = handle_session_cancel(
            &state,
            &sessions,
            &event_tx,
            Value::Null,
            Some(&params),
            true,
        )
        .await;
        assert!(
            resp.is_none(),
            "a notification cancel must produce no response frame"
        );
        let event: GatewayEvent = serde_json::from_str(
            &event_rx
                .recv()
                .await
                .expect("cancel must be forwarded to core"),
        )
        .unwrap();
        assert_eq!(event.event_type, "session_cancel");
        assert_eq!(event.platform, "acp");
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), cancel.notified())
                .await
                .is_err(),
            "gateway must not claim completion before the runtime terminates"
        );
    }

    #[tokio::test]
    async fn cancel_is_forwarded_for_runtime_work_between_prompts() {
        let sessions = sessions_map();
        let (event_tx, mut event_rx) = tokio::sync::broadcast::channel::<String>(4);
        let sid = format!("sess_{}", Uuid::new_v4());
        let channel_id = format!("acp_{}", Uuid::new_v4());
        sessions.lock().await.insert(
            sid.clone(),
            AcpSession {
                channel_id: channel_id.clone(),
                busy: false,
                cancel: None,
                mcp_servers: Vec::new(),
                session_meta: None,
                permission_relay: None,
            },
        );
        let params = json!({"sessionId": sid});
        let state = Arc::new(crate::AppState::test_default(event_tx.clone()));
        assert!(handle_session_cancel(
            &state,
            &sessions,
            &event_tx,
            Value::Null,
            Some(&params),
            true
        )
        .await
        .is_none());
        let event: GatewayEvent = serde_json::from_str(
            &event_rx
                .recv()
                .await
                .expect("idle outer session must forward runtime cancellation"),
        )
        .unwrap();
        assert_eq!(event.event_type, "session_cancel");
        assert_eq!(event.channel.id, channel_id);
    }

    #[tokio::test]
    async fn runtime_cancelled_reason_completes_outer_prompt_as_cancelled() {
        let registry = new_reply_registry();
        let (turn_tx, mut turn_rx) = mpsc::unbounded_channel::<ReplyChunk>();
        let (out_tx, _out_rx) = mpsc::unbounded_channel::<String>();
        registry.lock().unwrap().insert(
            "acp_chan".into(),
            ReplySink {
                turn_id: Some("evt_current".into()),
                tx: Some(turn_tx),
                session_id: "sess_chan".into(),
                out_tx,
                owner: "conn-test".into(),
                generation: 0,
                permission_relay: None,
            },
        );
        handle_reply(
            &reply("acp_chan", "evt_current", "", Some("finish_turn:cancelled")),
            &registry,
        )
        .await;
        assert!(matches!(turn_rx.try_recv(), Ok(ReplyChunk::Text(text)) if text.is_empty()));
        assert!(matches!(
            turn_rx.try_recv(),
            Ok(ReplyChunk::Done(Some(
                crate::adapters::acp_schema::StopReason::Cancelled
            )))
        ));
    }

    // Idle-timeout override: a sane value wins; missing, garbage, or
    // below-floor values fall back to the default instead of guessing.
    #[test]
    fn idle_timeout_env_override_resolves_sane_values_and_rejects_the_rest() {
        assert_eq!(idle_timeout_from_env(None), ACP_PROMPT_IDLE_TIMEOUT_SECS);
        assert_eq!(
            idle_timeout_from_env(Some("")),
            ACP_PROMPT_IDLE_TIMEOUT_SECS
        );
        assert_eq!(
            idle_timeout_from_env(Some("banana")),
            ACP_PROMPT_IDLE_TIMEOUT_SECS
        );
        assert_eq!(
            idle_timeout_from_env(Some("5")),
            ACP_PROMPT_IDLE_TIMEOUT_SECS
        );
        assert_eq!(idle_timeout_from_env(Some("30")), 30);
        assert_eq!(idle_timeout_from_env(Some(" 600 ")), 600);
    }

    // Version handshake meta: stamped values appear under their reverse-DNS
    // keys; unset or empty values omit the key entirely.
    #[test]
    fn version_handshake_meta_reports_stamped_values_and_omits_absent_ones() {
        let bare = version_handshake_meta(None, None);
        assert_eq!(bare.get("dev.openab/permissionRelay"), Some(&json!(true)));
        assert!(!bare.contains_key("dev.openab/buildSha"));
        assert!(!bare.contains_key("dev.openab/adapterVersion"));

        let empty = version_handshake_meta(Some(""), Some(""));
        assert!(!empty.contains_key("dev.openab/buildSha"));

        let full = version_handshake_meta(Some("1d86daa14566"), Some("claude-agent-acp@0.70.0"));
        assert_eq!(
            full.get("dev.openab/buildSha"),
            Some(&json!("1d86daa14566"))
        );
        assert_eq!(
            full.get("dev.openab/adapterVersion"),
            Some(&json!("claude-agent-acp@0.70.0"))
        );
    }

    // Pool-liveness bridge: the query carries the derived thread key, returns
    // the pool's answer, and degrades to None when no bridge is wired.
    #[tokio::test]
    async fn pool_liveness_query_round_trips_and_degrades_without_a_bridge() {
        let (btx, _) = tokio::sync::broadcast::channel(1);
        let mut state = crate::AppState::test_default(btx);
        assert_eq!(
            query_pool_liveness(&state, "acp_abc").await,
            None,
            "no bridge wired must yield None, not a guess"
        );

        let (tx, mut rx) =
            tokio::sync::mpsc::channel::<(String, tokio::sync::oneshot::Sender<bool>)>(4);
        state.acp_pool_liveness = Some(tx);
        tokio::spawn(async move {
            while let Some((key, reply)) = rx.recv().await {
                let _ = reply.send(key == "acp:acp_live");
            }
        });
        assert_eq!(query_pool_liveness(&state, "acp_live").await, Some(true));
        assert_eq!(query_pool_liveness(&state, "acp_gone").await, Some(false));
    }
}

/// End-to-end tests over the **real** `/acp` WebSocket route.
///
/// Every other test in this file calls the handlers directly with hand-built structures, so
/// nothing had ever exercised the axum route, the upgrade, the frame codec, or the request/reply
/// correlation across an actual socket. A reviewer raised exactly that: the tunnel was asserted
/// by construction rather than observed working. These bind a real listener and drive it with a
/// scripted `tokio-tungstenite` client — no browser, no model.
#[cfg(test)]
mod acp_ws_integration {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message as WsMessage;

    /// Serve `/acp` on an ephemeral loopback port. Returns the URL and the tunnel registry, so a
    /// test can drive the server side the way core does.
    async fn serve_with_events() -> (
        String,
        AcpTunnelRegistry,
        AcpReplyRegistry,
        tokio::sync::broadcast::Receiver<String>,
    ) {
        let (tx, rx) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(tx);
        state.acp = Some(AcpConfig {
            // Keyless loopback: no bearer. A client sending no `Origin` is accepted, which is
            // what a non-browser client (this test, and the real extension's native host) is.
            auth_key: None,
            control_key: None,
            allowed_origins: vec![],
            login_command: None,
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        let reply_registry = new_reply_registry();
        state.acp_reply_registry = Some(reply_registry.clone());
        let registry = new_tunnel_registry();
        state.acp_tunnel_registry = Some(registry.clone());

        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(std::sync::Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (format!("ws://{addr}/acp"), registry, reply_registry, rx)
    }

    #[test]
    fn steering_accepts_text_and_native_file_references_only() {
        let link = json!({"type":"resource_link","uri":"file:///tmp/shot.png","name":"shot.png"});
        let text = json!({"type":"text","text":"Look at this"});
        assert!(steering_prompt(&json!({"prompt":[text.clone(), link.clone()]})).is_some());
        assert!(steering_prompt(&json!({"prompt":[link]})).is_some());
        assert!(steering_prompt(&json!({"prompt":[]})).is_none());
        assert!(steering_prompt(&json!({"prompt":[{"type":"text","text":"  "}]})).is_none());
        assert!(steering_prompt(&json!({"prompt":[{"type":"resource_link","uri":""}]})).is_none());
        let unnamed = json!({"type":"resource_link","uri":"file:///tmp/shot.png"});
        assert!(steering_prompt(&json!({ "prompt": [unnamed] })).is_none());
        let upper = json!({"type":"resource_link","uri":"FILE:///tmp/a.png","name":"a.png"});
        assert!(steering_prompt(&json!({ "prompt": [upper] })).is_some());
        let remote = json!({"type":"resource_link","uri":"https://e/x","name":"x"});
        assert!(steering_prompt(&json!({ "prompt": [remote] })).is_none());
        assert!(steering_prompt(&json!({"prompt":[text, {"type":"audio","data":"x"}]})).is_none());
    }

    #[tokio::test]
    async fn native_steering_requires_operator_and_never_dispatches_another_prompt() {
        let (tx, mut events) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(tx);
        state.acp = Some(AcpConfig {
            auth_key: None,
            control_key: Some("operator-fixture-key".into()),
            allowed_origins: vec![],
            login_command: None,
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        state.acp_session_snapshot = Some(Arc::new(|_| {
            Box::pin(async { json!({"state":"active","steeringSupported":true}) })
        }));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = calls.clone();
        let release = Arc::new(tokio::sync::Notify::new());
        let provider_release = release.clone();
        state.acp_session_steer = Some(Arc::new(move |channel, prompt| {
            let count = count.clone();
            let release = provider_release.clone();
            Box::pin(async move {
                assert_eq!(channel, "acp_173201f5-7973-4186-ae78-e63c2988d1b9");
                assert_eq!(prompt, json!([{"type":"text","text":"Focus on tests"}]));
                count.fetch_add(1, Ordering::SeqCst);
                release.notified().await;
                Ok(json!({"outcome":"injected"}))
            })
        }));
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        for operator in [false, true] {
            let mut request = format!("ws://{addr}/acp").into_client_request().unwrap();
            if operator {
                request.headers_mut().insert(
                    "Authorization",
                    "Bearer operator-fixture-key".parse().unwrap(),
                );
            }
            let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
            send(&mut ws, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"_meta":{"dev.openab/sessionSnapshots":true}}}})).await;
            let _ = recv(&mut ws).await;
            send(&mut ws, json!({"jsonrpc":"2.0","id":2,"method":"_openab/session/steer","params":{"sessionId":"sess_173201f5-7973-4186-ae78-e63c2988d1b9","messageId":"173201f5-7973-4186-ae78-e63c2988d1b8","prompt":[{"type":"text","text":"Focus on tests"}]}})).await;
            if operator {
                send(&mut ws, json!({"jsonrpc":"2.0","id":3,"method":"_openab/session/state","params":{"sessionId":"sess_173201f5-7973-4186-ae78-e63c2988d1b9"}})).await;
                let state = tokio::time::timeout(std::time::Duration::from_secs(1), recv(&mut ws))
                    .await
                    .expect("steering must not block socket reads");
                assert_eq!(state["id"], 3);
                release.notify_one();
                let result = recv(&mut ws).await;
                assert_eq!(result["result"]["outcome"], "injected");
            } else {
                let result = recv(&mut ws).await;
                assert_eq!(result["error"]["code"], -32003);
            }
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn credential_refresh_requires_operator_and_reaches_the_pool() {
        let (tx, _events) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(tx);
        state.acp = Some(AcpConfig {
            auth_key: None,
            control_key: Some("operator-fixture-key".into()),
            allowed_origins: vec![],
            login_command: None,
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        let calls = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = calls.clone();
        state.acp_session_credentials = Some(Arc::new(move |channel, expected, credentials| {
            assert_eq!(expected, json!({"NUPHOS_TOKEN":"stale"}));
            seen.lock().unwrap().push((channel, credentials));
            Box::pin(async { Ok(()) })
        }));
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        for operator in [false, true] {
            let mut request = format!("ws://{addr}/acp").into_client_request().unwrap();
            if operator {
                request.headers_mut().insert(
                    "Authorization",
                    "Bearer operator-fixture-key".parse().unwrap(),
                );
            }
            let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
            send(&mut ws, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}})).await;
            let init = recv(&mut ws).await;
            assert_eq!(init["result"]["agentCapabilities"]["_meta"]["dev.openab/credentialRefresh"], true);
            send(&mut ws, json!({"jsonrpc":"2.0","id":2,"method":"_openab/session/credentials","params":{"sessionId":"sess_173201f5-7973-4186-ae78-e63c2988d1b9","expected":{"NUPHOS_TOKEN":"stale"},"credentials":{"NUPHOS_TOKEN":"fresh"}}})).await;
            let result = recv(&mut ws).await;
            if operator {
                assert_eq!(result["result"], json!({}));
                send(&mut ws, json!({"jsonrpc":"2.0","id":3,"method":"_openab/session/credentials","params":{"sessionId":"sess_173201f5-7973-4186-ae78-e63c2988d1b9","credentials":{"NUPHOS_TOKEN":"fresh"}}})).await;
                assert_eq!(recv(&mut ws).await["error"]["code"], -32602);
            } else {
                assert_eq!(result["error"]["code"], -32003);
            }
        }
        assert_eq!(
            *calls.lock().unwrap(),
            vec![(
                "acp_173201f5-7973-4186-ae78-e63c2988d1b9".to_string(),
                json!({"NUPHOS_TOKEN":"fresh"})
            )]
        );
    }

    #[tokio::test]
    async fn execution_snapshot_reads_without_resuming_or_claiming_the_session() {
        let (tx, mut events) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(tx);
        state.acp = Some(AcpConfig {
            auth_key: None,
            control_key: Some("operator-fixture-key".into()),
            allowed_origins: vec![],
            login_command: None,
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        let registry = new_reply_registry();
        state.acp_reply_registry = Some(registry.clone());
        state.acp_session_snapshot = Some(Arc::new(|channel| {
            Box::pin(async move {
                assert_eq!(channel, "acp_173201f5-7973-4186-ae78-e63c2988d1b9");
                json!({"epoch": "provider-process", "revision": 4, "state": "idle"})
            })
        }));
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request = format!("ws://{addr}/acp").into_client_request().unwrap();
        request.headers_mut().insert(
            "Authorization",
            "Bearer operator-fixture-key".parse().unwrap(),
        );
        let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        send(
            &mut ws,
            json!({"jsonrpc":"2.0", "id":1, "method":"initialize", "params":{"protocolVersion":1,"clientCapabilities":{"_meta":{"dev.openab/sessionSnapshots":true}}}}),
        )
        .await;
        let _ = recv(&mut ws).await;
        send(&mut ws, json!({"jsonrpc":"2.0", "id":2, "method":"_openab/session/state", "params":{"sessionId":"sess_173201f5-7973-4186-ae78-e63c2988d1b9"}})).await;
        let snapshot = recv(&mut ws).await;
        assert_eq!(snapshot["result"]["state"], "idle");
        assert_eq!(snapshot["result"]["revision"], 0);
        assert_eq!(snapshot["result"]["providerEpoch"], "provider-process");
        assert_ne!(snapshot["result"]["epoch"], "provider-process");
        assert_eq!(snapshot["result"]["actions"]["send"], true);
        assert!(registry.lock().unwrap().is_empty());
        assert!(
            events.try_recv().is_err(),
            "a state read must not dispatch work"
        );
    }

    /// A session's runtime_state goes to the connection that holds it now, not to every
    /// connection that ever resumed it: each extra copy crossed the same tunnel again.
    #[tokio::test]
    async fn runtime_state_is_pushed_only_to_the_connection_holding_the_session() {
        let (events, _) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(events);
        state.acp = Some(AcpConfig {
            auth_key: None,
            control_key: None,
            allowed_origins: vec![],
            login_command: None,
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        state.acp_reply_registry = Some(new_reply_registry());
        let busy = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let provider_busy = busy.clone();
        state.acp_session_snapshot = Some(Arc::new(move |_| {
            let busy = provider_busy.load(Ordering::SeqCst);
            Box::pin(async move {
                json!({"epoch": "provider", "revision": u64::from(busy), "state": if busy { "active" } else { "idle" }})
            })
        }));
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/acp", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let initialize = json!({"jsonrpc":"2.0", "id":1, "method":"initialize", "params":{"protocolVersion":1,"clientCapabilities":{"_meta":{"dev.openab/sessionSnapshots":true}}}});
        let is_state = |f: &Value| f["params"]["update"]["sessionUpdate"] == "runtime_state";
        // Frames for up to `ms`, so a push that should not come has had time to.
        async fn drain(ws: &mut Ws, ms: u64) -> Vec<Value> {
            let mut frames = vec![];
            let until = tokio::time::Instant::now() + std::time::Duration::from_millis(ms);
            while let Ok(Some(Ok(WsMessage::Text(t)))) =
                tokio::time::timeout_at(until, ws.next()).await
            {
                frames.push(serde_json::from_str(&t).unwrap());
            }
            frames
        }

        let (mut a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(&mut a, initialize.clone()).await;
        let _ = recv(&mut a).await;
        send(&mut a, json!({"jsonrpc":"2.0", "id":2, "method":"session/new", "params":{"cwd":"/w","mcpServers":[]}})).await;
        let session_id = loop {
            let f = recv(&mut a).await;
            if f.get("id") == Some(&json!(2)) {
                break f["result"]["sessionId"].as_str().unwrap().to_string();
            }
        };
        assert!(
            drain(&mut a, 600).await.iter().any(is_state),
            "A holds the session"
        );

        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(&mut b, initialize).await;
        let _ = recv(&mut b).await;
        send(&mut b, json!({"jsonrpc":"2.0", "id":2, "method":"session/resume", "params":{"sessionId":session_id,"cwd":"/w","mcpServers":[]}})).await;
        let _ = drain(&mut b, 600).await;
        let _ = drain(&mut a, 0).await;

        busy.store(true, Ordering::SeqCst);
        let on_b = drain(&mut b, 800).await;
        let on_a = drain(&mut a, 800).await;
        assert!(
            on_b.iter().any(is_state),
            "B now holds the session: {on_b:?}"
        );
        assert!(!on_a.iter().any(is_state), "A no longer holds it: {on_a:?}");
    }

    #[tokio::test]
    async fn ordinary_client_cannot_control_foreign_runtime_requests() {
        let (events, _) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(events);
        state.acp = Some(AcpConfig {
            auth_key: Some("ordinary-fixture".into()),
            control_key: Some("independent-operator-fixture".into()),
            allowed_origins: vec![],
            login_command: None,
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        state.acp_session_snapshot = Some(Arc::new(|_| {
            Box::pin(async { json!({"epoch":"provider","state":"active","operation":"prompt"}) })
        }));
        state.acp_session_inventory = Some(Arc::new(|| Box::pin(async { vec![] })));
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        for (key, operator) in [
            ("ordinary-fixture", false),
            ("independent-operator-fixture", true),
        ] {
            let mut request = format!("ws://{address}/acp").into_client_request().unwrap();
            request
                .headers_mut()
                .insert("Authorization", format!("Bearer {key}").parse().unwrap());
            let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
            send(&mut ws, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"_meta":{"dev.openab/sessionSnapshots":true}}}})).await;
            let _ = recv(&mut ws).await;
            let session = "sess_173201f5-7973-4186-ae78-e63c2988d1b9";
            let register = json!({"sessionId":session,"operation":"register","userId":"victim","waitId":"w","wait":{"userId":"victim","waitId":"w","kind":"plan","sessionId":session}});
            let resolve = json!({"sessionId":session,"operation":"resolve","userId":"victim","waitId":"w","decision":{"approved":true}});
            for (method, params) in [
                ("_openab/runtime/state", json!({})),
                ("_openab/session/state", json!({"sessionId":session})),
                ("_openab/session/requests", register),
                ("_openab/session/requests", resolve),
            ] {
                send(
                    &mut ws,
                    json!({"jsonrpc":"2.0","id":2,"method":method,"params":params}),
                )
                .await;
                let response = recv(&mut ws).await;
                if operator {
                    assert!(response.get("result").is_some(), "{response}");
                } else {
                    assert_eq!(response["error"]["code"], -32003, "{response}");
                }
            }
        }
    }

    /// The whole point of the method: an operator drives a device sign-in it can watch
    /// but never holds the credential for, and an ordinary client cannot reach it at all.
    #[tokio::test]
    async fn an_operator_drives_a_device_sign_in_and_an_ordinary_client_cannot() {
        let _serialized = runtime_login::TEST_GUARD.lock().await;
        let (events, _) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(events);
        let credential = std::env::temp_dir().join(format!("openab-login-{}", Uuid::new_v4()));
        state.acp = Some(AcpConfig {
            auth_key: Some("ordinary-fixture".into()),
            control_key: Some("operator-fixture-key-that-is-long-enough".into()),
            allowed_origins: vec![],
            login_command: Some(LoginCommand {
                program: "/bin/sh".into(),
                args: vec![
                    "-c".into(),
                    format!(
                        "printf '{{\"type\":\"device\",\"userCode\":\"ABCD-1234\"}}\\n'; printf x > {}",
                        credential.display()
                    ),
                ],
            }),
            auth_file: Some(credential.display().to_string()),
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        state.acp_session_inventory = Some(Arc::new(|| Box::pin(async { vec![] })));
        let suspends = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = suspends.clone();
        state.acp_runtime_suspend = Some(Arc::new(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        }));
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let connect = |key: &str| {
            let mut request = format!("ws://{address}/acp").into_client_request().unwrap();
            request
                .headers_mut()
                .insert("Authorization", format!("Bearer {key}").parse().unwrap());
            request
        };
        let initialize =
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}});
        let login = json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/login","params":{"attemptId":"attempt-ws"}});

        let (mut ordinary, _) = tokio_tungstenite::connect_async(connect("ordinary-fixture"))
            .await
            .unwrap();
        send(&mut ordinary, initialize.clone()).await;
        let _ = recv(&mut ordinary).await;
        send(&mut ordinary, login.clone()).await;
        let refused = recv(&mut ordinary).await;
        assert_eq!(refused["error"]["code"], -32003, "{refused}");
        send(
            &mut ordinary,
            json!({"jsonrpc":"2.0","id":3,"method":"_openab/runtime/login/input","params":{"attemptId":"attempt-ws","text":"code#state"}}),
        )
        .await;
        let refused = recv(&mut ordinary).await;
        assert_eq!(refused["error"]["code"], -32003, "{refused}");

        let (mut operator, _) =
            tokio_tungstenite::connect_async(connect("operator-fixture-key-that-is-long-enough"))
                .await
                .unwrap();
        send(&mut operator, initialize).await;
        let _ = recv(&mut operator).await;
        // Nothing has signed in yet, so the runtime reports it authoritatively.
        send(
            &mut operator,
            json!({"jsonrpc":"2.0","id":9,"method":"_openab/runtime/state","params":{}}),
        )
        .await;
        let runtime_state = recv(&mut operator).await;
        assert_eq!(runtime_state["result"]["authenticated"], false);
        let usage = &runtime_state["result"]["usage"];
        for key in [
            "cpuMillicores",
            "memoryBytes",
            "diskUsedBytes",
            "diskTotalBytes",
        ] {
            assert!(usage.get(key).is_some(), "{runtime_state}");
        }
        assert!(
            usage["diskTotalBytes"].is_null(),
            "no disk paths configured"
        );

        send(&mut operator, login).await;
        let mut started = None;
        let mut frames = Vec::new();
        while frames
            .last()
            .is_none_or(|frame: &Value| frame["type"] != "exited")
        {
            let message = recv(&mut operator).await;
            if message["id"] == 2 {
                started = Some(message);
                continue;
            }
            assert_eq!(message["method"], runtime_login::LOGIN_FRAME_METHOD);
            assert_eq!(message["params"]["attemptId"], "attempt-ws");
            frames.push(message["params"]["frame"].clone());
        }
        if started.is_none() {
            started = Some(recv(&mut operator).await);
        }
        // The call answers once the command runs; the device flow outlives it.
        assert_eq!(started.unwrap()["result"]["started"], true);
        // The credential stayed in the container — only the device frame crossed the wire.
        assert_eq!(
            frames,
            vec![
                json!({"type": "device", "userCode": "ABCD-1234"}),
                json!({"type": "exited", "exitCode": 0}),
            ]
        );
        assert_eq!(suspends.load(Ordering::SeqCst), 1);

        send(
            &mut operator,
            json!({"jsonrpc":"2.0","id":10,"method":"_openab/runtime/state","params":{}}),
        )
        .await;
        assert_eq!(recv(&mut operator).await["result"]["authenticated"], true);
        let _ = std::fs::remove_file(&credential);
    }

    /// A connection that dies mid-flow ends its sign-in, and nothing it left behind
    /// stands in the way of the next one.
    #[tokio::test]
    async fn a_dropped_connection_hands_its_sign_in_slot_to_the_next_one() {
        let _serialized = runtime_login::TEST_GUARD.lock().await;
        let (events, _) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(events);
        state.acp = Some(AcpConfig {
            auth_key: None,
            control_key: Some("operator-fixture-key-that-is-long-enough".into()),
            allowed_origins: vec![],
            login_command: Some(LoginCommand {
                program: "/bin/sh".into(),
                args: vec![
                    "-c".into(),
                    "printf '{\"type\":\"device\"}\\n'; sleep 120".into(),
                ],
            }),
            auth_file: None,
            runtime_jobs: RuntimeJobs::default(),
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        state.acp_session_inventory = Some(Arc::new(|| Box::pin(async { vec![] })));
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let open = || async {
            let mut request = format!("ws://{address}/acp").into_client_request().unwrap();
            request.headers_mut().insert(
                "Authorization",
                "Bearer operator-fixture-key-that-is-long-enough"
                    .parse()
                    .unwrap(),
            );
            let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();

            send(&mut ws, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}})).await;
            let _ = recv(&mut ws).await;

            ws
        };

        let mut abandoned = open().await;

        send(
            &mut abandoned,
            json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/login","params":{"attemptId":"abandoned"}}),
        )
        .await;
        // The device frame proves the command is running.
        loop {
            let message = recv(&mut abandoned).await;
            if message["params"]["attemptId"] == "abandoned" {
                break;
            }
        }
        drop(abandoned);

        let mut successor = open().await;

        send(
            &mut successor,
            json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/login","params":{"attemptId":"successor"}}),
        )
        .await;
        loop {
            let message = recv(&mut successor).await;
            if message["params"]["frame"]["type"] == "device" {
                assert_eq!(message["params"]["attemptId"], "successor", "{message}");
                break;
            }
        }
        send(
            &mut successor,
            json!({"jsonrpc":"2.0","id":3,"method":"_openab/runtime/login/cancel","params":{"attemptId":"successor"}}),
        )
        .await;
        loop {
            let message = recv(&mut successor).await;

            if message["params"]["frame"]["type"] == "exited" {
                assert_eq!(message["params"]["frame"]["exitCode"], -1);
                break;
            }
        }
    }

    async fn serve_runtime_jobs(jobs: RuntimeJobs) -> std::net::SocketAddr {
        let (events, _) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(events);
        state.acp = Some(AcpConfig {
            auth_key: Some("ordinary-fixture".into()),
            control_key: Some("operator-fixture-key-that-is-long-enough".into()),
            allowed_origins: vec![],
            login_command: None,
            auth_file: None,
            runtime_jobs: jobs,
            disk_paths: vec![],
            credentials: None,
            console: None,
        });
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        address
    }

    async fn open_with_key(address: std::net::SocketAddr, key: &str) -> (Ws, Value) {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request = format!("ws://{address}/acp").into_client_request().unwrap();
        request
            .headers_mut()
            .insert("Authorization", format!("Bearer {key}").parse().unwrap());
        let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        send(
            &mut ws,
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
        )
        .await;
        let initialized = recv(&mut ws).await;
        (ws, initialized)
    }

    #[tokio::test]
    async fn runtime_terminal_requires_operator_and_redacts_input() {
        let address = serve_runtime_jobs(RuntimeJobs::default()).await;
        let (mut ordinary, _) = open_with_key(address, "ordinary-fixture").await;
        let request = json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/terminal/input","params":{"terminalId":"one","data":"secret-password"}});
        send(&mut ordinary, request.clone()).await;
        assert_eq!(recv(&mut ordinary).await["error"]["code"], -32003);
        assert!(!trace_frame(&request.to_string()).contains("secret-password"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runtime_terminal_streams_over_the_operator_socket() {
        use base64::Engine;
        let _guard = runtime_login::TEST_GUARD.lock().await;
        let root = std::env::temp_dir().join(format!("terminal-ws-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::env::set_var("OPENAB_RUNTIME_TERMINAL_CWD", &root);
        std::env::set_var("OPENAB_RUNTIME_TERMINAL_HOME", &root);
        let address = serve_runtime_jobs(RuntimeJobs::default()).await;
        let (mut operator, initialized) =
            open_with_key(address, "operator-fixture-key-that-is-long-enough").await;
        assert_eq!(
            initialized["result"]["agentCapabilities"]["_meta"]["dev.openab/runtimeTerminal"],
            true
        );
        send(&mut operator,json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/terminal/start","params":{"terminalId":"one","sessionId":"conversation"}})).await;
        loop {
            if recv(&mut operator).await["id"] == 2 {
                break;
            }
        }
        send(&mut operator,json!({"jsonrpc":"2.0","id":3,"method":"_openab/runtime/terminal/input","params":{"terminalId":"one","data":"printf '\\nOVER_ACP\\n'\n"}})).await;
        let mut text = String::new();
        let mut id = 4;
        tokio::time::timeout(std::time::Duration::from_secs(5),async {
            while !text.contains("\r\nOVER_ACP\r\n") {
                let value = recv(&mut operator).await;
                if let Some(data) = value["params"]["frame"]["data"].as_str() {
                    text.push_str(&String::from_utf8_lossy(&base64::engine::general_purpose::STANDARD.decode(data).unwrap()));
                    send(&mut operator,json!({"jsonrpc":"2.0","id":id,"method":"_openab/runtime/terminal/ack","params":{"terminalId":"one","sequence":value["params"]["frame"]["sequence"]}})).await;
                    id += 1;
                }
            }
        }).await.unwrap();
        operator.close(None).await.unwrap();
        std::env::remove_var("OPENAB_RUNTIME_TERMINAL_CWD");
        std::env::remove_var("OPENAB_RUNTIME_TERMINAL_HOME");
        std::fs::remove_dir_all(root).unwrap();
    }

    fn sh_job(script: &str) -> LoginCommand {
        LoginCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
        }
    }

    #[tokio::test]
    async fn only_the_operator_credential_runs_an_advertised_runtime_job() {
        let _serialized = runtime_job::TEST_GUARD.lock().await;
        let address = serve_runtime_jobs(
            RuntimeJobs::default().with_job("echo", sh_job("cat; printf \" $NUPHOS_TOKEN\"")),
        )
        .await;
        let job = json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/job","params":{
            "jobId":"ws-1","job":"echo","stdin":"hello","env":{"NUPHOS_TOKEN":"t0k"},
            "timeoutMs":10_000,"maxStdoutBytes":1024
        }});

        let (mut ordinary, initialized) = open_with_key(address, "ordinary-fixture").await;
        assert_eq!(
            initialized["result"]["agentCapabilities"]["_meta"]["dev.openab/runtimeJobs"],
            json!(["echo"])
        );
        send(&mut ordinary, job.clone()).await;
        assert_eq!(recv(&mut ordinary).await["error"]["code"], -32003);

        let (mut operator, _) =
            open_with_key(address, "operator-fixture-key-that-is-long-enough").await;
        send(&mut operator, job).await;
        let done = recv(&mut operator).await;
        assert_eq!(
            done["result"],
            json!({"exitCode":0,"stdout":"hello t0k","truncated":false,"timedOut":false}),
            "{done}"
        );

        send(
            &mut operator,
            json!({"jsonrpc":"2.0","id":3,"method":"_openab/runtime/job","params":{"jobId":"ws-2","job":"cost-panel"}}),
        )
        .await;
        let unknown = recv(&mut operator).await;
        assert_eq!(
            unknown["error"]["code"],
            runtime_job::JOB_UNKNOWN,
            "{unknown}"
        );
    }

    #[tokio::test]
    async fn a_closed_connection_kills_its_runtime_jobs() {
        let _serialized = runtime_job::TEST_GUARD.lock().await;
        let marker = std::env::temp_dir().join(format!("openab-ws-job-{}", Uuid::new_v4()));
        let address = serve_runtime_jobs(RuntimeJobs::default().with_job(
            "slow",
            sh_job(&format!("sleep 60 & echo $! > {}; wait", marker.display())),
        ))
        .await;
        let (mut operator, _) =
            open_with_key(address, "operator-fixture-key-that-is-long-enough").await;
        send(
            &mut operator,
            json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/job","params":{"jobId":"ws-slow","job":"slow"}}),
        )
        .await;
        let pid = loop {
            if let Some(pid) = std::fs::read_to_string(&marker)
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
            {
                break pid;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        };
        drop(operator);

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        // SAFETY: signal 0 only checks whether the pid exists.
        while unsafe { libc::kill(pid, 0) } == 0 || runtime_job::running_count() > 0 {
            assert!(
                std::time::Instant::now() < deadline,
                "job outlived its connection"
            );
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let _ = std::fs::remove_file(marker);
    }

    async fn serve() -> (String, AcpTunnelRegistry) {
        let (url, tunnel_registry, _reply_registry, _event_rx) = serve_with_events().await;
        (url, tunnel_registry)
    }

    type Ws = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    async fn send(ws: &mut Ws, v: Value) {
        ws.send(WsMessage::Text(v.to_string())).await.unwrap();
    }

    /// Next JSON frame from the server, skipping anything that is not text (pings etc).
    ///
    /// The timeout guards against a hang, so it should be generous rather than tight: it is not
    /// measuring anything. At 5s it produced two transient failures when these WebSocket tests ran
    /// alongside the rest of the suite — a budget that depends on machine load is a flaky test, and
    /// a flaky test in a security-adjacent area is worse than none, because the next person learns
    /// to re-run it.
    async fn recv(ws: &mut Ws) -> Value {
        loop {
            match tokio::time::timeout(std::time::Duration::from_secs(30), ws.next())
                .await
                .expect("timed out waiting for a server frame")
                .expect("socket closed")
                .unwrap()
            {
                WsMessage::Text(t) => return serde_json::from_str(&t).unwrap(),
                WsMessage::Close(_) => panic!("server closed the socket"),
                _ => continue,
            }
        }
    }

    /// A prompt must route permission requests through the connection that is driving that turn.
    ///
    /// This deliberately crosses the real WebSocket read loop twice. Connection A creates the
    /// session with a relay handle bound to A; connection B resumes it with a fresh relay handle;
    /// then A starts the next prompt from its still-live connection. The permission request is
    /// issued through the sink activated by `handle_session_prompt`, so observing it on A proves
    /// prompt activation replaces B's stored resume path with the connection driving the turn.
    #[tokio::test]
    async fn a_prompt_after_another_connection_resumes_relays_permission_to_the_prompter() {
        let (url, _tunnels, reply_registry, mut event_rx) = serve_with_events().await;

        let (mut first, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut first,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        assert!(recv(&mut first).await.get("result").is_some());
        send(
            &mut first,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": {
                    "cwd": "/w",
                    "mcpServers": [],
                    "_meta": {"dev.openab/permissionPolicy": "relay"}
                }
            }),
        )
        .await;
        let created = recv(&mut first).await;
        let session_id = created["result"]["sessionId"]
            .as_str()
            .expect("session/new must return a sessionId")
            .to_string();
        let channel_id = derive_channel_id(&session_id).unwrap();

        let (mut resumed, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut resumed,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        assert!(recv(&mut resumed).await.get("result").is_some());
        send(
            &mut resumed,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {
                    "sessionId": session_id,
                    "cwd": "/w",
                    "mcpServers": [],
                    "_meta": {"dev.openab/permissionPolicy": "relay"}
                }
            }),
        )
        .await;
        let resume_response = recv(&mut resumed).await;
        assert!(
            resume_response.get("result").is_some(),
            "resume failed: {resume_response}"
        );

        send(
            &mut first,
            json!({
                "jsonrpc": "2.0", "id": 3, "method": "session/prompt",
                "params": {
                    "sessionId": session_id,
                    "prompt": [{"type": "text", "text": "use a protected tool"}]
                }
            }),
        )
        .await;
        event_rx
            .recv()
            .await
            .expect("prompt must dispatch a GatewayEvent");
        assert!(permission_relay_required(&reply_registry, &channel_id).unwrap());

        let registry = reply_registry.clone();
        let relay_channel = channel_id.clone();
        let relay = tokio::spawn(async move {
            request_permission(
                &registry,
                &relay_channel,
                true,
                json!({
                    "sessionId": "sess_inner",
                    "toolCall": {"toolCallId": "tool-1", "title": "Run protected tool"},
                    "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}]
                }),
            )
            .await
        });

        let permission = tokio::select! {
            frame = recv(&mut first) => frame,
            frame = recv(&mut resumed) => panic!(
                "permission request followed the stale resume relay instead of the prompting connection: {frame}"
            ),
        };
        assert_eq!(permission["method"], json!("session/request_permission"));
        assert_eq!(permission["params"]["sessionId"], json!(session_id));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(200), resumed.next())
                .await
                .is_err(),
            "the connection that only resumed must not receive another connection's permission request"
        );
        send(
            &mut first,
            json!({
                "jsonrpc": "2.0",
                "id": permission["id"].clone(),
                "result": {"outcome": {"outcome": "selected", "optionId": "allow"}}
            }),
        )
        .await;
        assert!(
            relay.await.unwrap().is_ok(),
            "the resumed connection's decision must resolve"
        );

        send(
            &mut first,
            json!({
                "jsonrpc": "2.0",
                "method": "session/cancel",
                "params": {"sessionId": session_id}
            }),
        )
        .await;
        let cancelled: Value = serde_json::from_str(&event_rx.recv().await.unwrap()).unwrap();
        assert_eq!(cancelled["event_type"], "session_cancel");
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), first.next())
                .await
                .is_err(),
            "cancel must wait for the native runtime outcome"
        );
        let turn_id = reply_registry
            .lock()
            .unwrap()
            .get(&channel_id)
            .unwrap()
            .turn_id
            .clone()
            .unwrap();
        handle_reply(
            &GatewayReply {
                schema: "openab.gateway.reply.v1".into(),
                reply_to: turn_id,
                platform: "acp".into(),
                channel: ReplyChannel {
                    id: channel_id,
                    thread_id: None,
                },
                content: Content {
                    content_type: "text".into(),
                    text: String::new(),
                    attachments: Vec::new(),
                },
                command: Some("finish_turn:cancelled".into()),
                request_id: None,
                quote_message_id: None,
            },
            &reply_registry,
        )
        .await;
        let prompt_response = recv(&mut first).await;
        assert_eq!(prompt_response["id"], json!(3));
        assert_eq!(prompt_response["result"]["stopReason"], json!("cancelled"));
    }

    /// Handle a frame belonging to the inner MCP lifecycle, if it is one.
    ///
    /// Returns `Some("initialize")` after answering the request, `Some("initialized")` after
    /// consuming the notification that follows it, `None` for anything else.
    ///
    /// Deliberately a classifier, not a loop. The first version looped on `recv` until it saw the
    /// initialize and dropped everything else on the way — including the `session/new` response
    /// its caller was still waiting for, which hung. A helper that eats frames its caller needs is
    /// worse than no helper: every call site is already a dispatch loop, so this handles one frame
    /// and hands the rest back.
    async fn handled_inner_lifecycle(ws: &mut Ws, frame: &Value) -> Option<&'static str> {
        if frame.get("method").and_then(Value::as_str) != Some("mcp/message") {
            return None;
        }
        match frame["params"]["method"].as_str() {
            Some("initialize") => {
                send(
                    ws,
                    json!({
                        "jsonrpc": "2.0", "id": frame["id"].clone(),
                        "result": {
                            "protocolVersion": "2025-06-18",
                            "capabilities": { "tools": {} },
                            "serverInfo": { "name": "test-ext", "version": "0" }
                        }
                    }),
                )
                .await;
                Some("initialize")
            }
            // A notification: no reply is owed, but it must still be taken off the socket or the
            // next `recv` in a test mistakes it for the frame it was waiting for.
            Some("notifications/initialized") => Some("initialized"),
            _ => None,
        }
    }

    /// Drive `initialize` + `session/new` declaring one `type:acp` server, then answer the
    /// `mcp/connect` the gateway sends back. Returns the session id.
    async fn handshake(ws: &mut Ws, acp_id: &str, name: &str, connection_id: &str) -> String {
        send(
            ws,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let init = recv(ws).await;
        assert!(init.get("result").is_some(), "initialize failed: {init}");

        send(
            ws,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": {
                    "cwd": "/w",
                    "mcpServers": [{"type": "acp", "id": acp_id, "name": name}]
                }
            }),
        )
        .await;

        // The gateway now does two things concurrently: answer session/new, and open the tunnel
        // by sending mcp/connect. Order is not guaranteed, so accept either first.
        // Three things must land before this returns, and the third is easy to forget: the
        // gateway registers the tunnel only after the inner MCP handshake completes, so returning
        // once `mcp/connect` is answered leaves the `initialize` unread in the socket. Nobody is
        // polling the socket after that, the gateway times out, and the establish fails — which
        // shows up as "no tunnel registered" rather than anything about initialize.
        let mut session_id = None;
        let mut connected = false;
        let mut lifecycle = 0;
        while session_id.is_none() || !connected || lifecycle < 2 {
            let frame = recv(ws).await;
            if handled_inner_lifecycle(ws, &frame).await.is_some() {
                lifecycle += 1;
                continue;
            }
            if frame.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                assert_eq!(
                    frame["params"]["acpId"],
                    json!(acp_id),
                    "mcp/connect must name the declared id"
                );
                send(
                    ws,
                    json!({
                        "jsonrpc": "2.0", "id": frame["id"].clone(),
                        "result": {"connectionId": connection_id}
                    }),
                )
                .await;
                connected = true;
            } else if frame.get("id") == Some(&json!(2)) {
                session_id = Some(
                    frame["result"]["sessionId"]
                        .as_str()
                        .expect("sessionId")
                        .to_string(),
                );
            }
        }
        session_id.unwrap()
    }

    /// Wait until `n` tunnels are registered.
    ///
    /// Registration happens *after* the client answers `mcp/connect` — the establishing task still
    /// has to build the handle and take the registry lock — so reading the registry straight after
    /// replying is a race. Polling the real condition is honest; sleeping a fixed interval and
    /// hoping would make this test flaky on a loaded machine.
    async fn wait_for_tunnels(registry: &AcpTunnelRegistry, n: usize) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let len = registry.lock().unwrap().len();
            if len == n {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "expected {n} tunnel(s) registered, still {len} after 5s"
            );
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    /// The tunnel is not usable until the inner MCP lifecycle has completed.
    ///
    /// MCP requires `initialize` → response → `notifications/initialized` before any other
    /// request. Driven over the socket because the ordering is the whole assertion: a unit test of
    /// the handshake function could confirm it sends the right frames while saying nothing about
    /// whether `tools/list` can still arrive first.
    #[tokio::test]
    async fn the_inner_mcp_lifecycle_completes_before_the_tunnel_is_registered() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut ws).await;
        send(&mut ws, json!({
            "jsonrpc": "2.0", "id": 2, "method": "session/new",
            "params": {"cwd": "/w", "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
        })).await;

        // Bounded explicitly, with its own message. Letting the generic `recv` timeout catch a
        // missing lifecycle works, but it costs 30s and reports "timed out waiting for a server
        // frame" — which names the harness rather than the regression. A test that catches a bug
        // should also say which bug.
        let collect = async {
            let mut order: Vec<String> = Vec::new();
            let mut connected = false;
            let mut lifecycle = 0;
            while !connected || lifecycle < 2 {
                let f = recv(&mut ws).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                    order.push("mcp/connect".into());
                    send(
                        &mut ws,
                        json!({
                            "jsonrpc": "2.0", "id": f["id"].clone(),
                            "result": {"connectionId": "conn-1"}
                        }),
                    )
                    .await;
                    connected = true;
                } else if f.get("method").and_then(Value::as_str) == Some("mcp/message") {
                    let inner = f["params"]["method"].as_str().unwrap_or("").to_string();
                    order.push(inner.clone());
                    if inner == "initialize" {
                        // The registry must still be empty: a server that has not answered
                        // `initialize` has not agreed to serve anything yet.
                        assert!(
                            registry.lock().unwrap().is_empty(),
                            "the tunnel was registered before the MCP handshake completed"
                        );
                        send(
                            &mut ws,
                            json!({
                                "jsonrpc": "2.0", "id": f["id"].clone(),
                                "result": {
                                    "protocolVersion": "2025-06-18",
                                    "capabilities": { "tools": {} },
                                    "serverInfo": { "name": "test-ext", "version": "0" }
                                }
                            }),
                        )
                        .await;
                    }
                    lifecycle += 1;
                }
            }
            order
        };
        let order = tokio::time::timeout(std::time::Duration::from_secs(10), collect)
            .await
            .expect(
                "no inner MCP lifecycle on the tunnel: the gateway connected but never sent \
                 `initialize`, so a standards-compliant client MCP server would be asked for tools \
                 before it had been initialized",
            );

        assert_eq!(
            order,
            vec![
                "mcp/connect".to_string(),
                "initialize".to_string(),
                "notifications/initialized".to_string()
            ],
            "the gateway must connect, then initialize, then notify — in that order"
        );
        wait_for_tunnels(&registry, 1).await;
    }

    /// A server that refuses the handshake must not be registered.
    ///
    /// `inner_mcp_handshake`'s doc promises "failure here fails the establish, so a server that
    /// cannot complete the handshake never reaches the registry" — and nothing tested it. The
    /// ordering test cannot: change the call to `let _ = inner_mcp_handshake(...)` and the frame
    /// order is unchanged, the registry is still empty when `initialize` arrives, and it stays
    /// green while refusing servers get registered anyway.
    #[tokio::test]
    async fn a_server_that_refuses_initialize_is_not_registered() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut ws).await;
        send(&mut ws, json!({
            "jsonrpc": "2.0", "id": 2, "method": "session/new",
            "params": {"cwd": "/w", "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
        })).await;

        // Answer `mcp/connect`, then REFUSE `initialize` the way a server that will not serve us
        // does: a JSON-RPC error, per the contract's "an inner MCP-level error is returned as the
        // outer JSON-RPC `error`".
        let mut refused = false;
        while !refused {
            let f = recv(&mut ws).await;
            match f.get("method").and_then(Value::as_str) {
                Some("mcp/connect") => {
                    send(
                        &mut ws,
                        json!({
                            "jsonrpc": "2.0", "id": f["id"].clone(),
                            "result": {"connectionId": "conn-1"}
                        }),
                    )
                    .await;
                }
                Some("mcp/message") if f["params"]["method"] == json!("initialize") => {
                    send(
                        &mut ws,
                        json!({
                            "jsonrpc": "2.0", "id": f["id"].clone(),
                            "error": {"code": -32603, "message": "not accepting connections"}
                        }),
                    )
                    .await;
                    refused = true;
                }
                _ => {}
            }
        }

        // The client opened a connection for us and we are not going to use it, so it is owed an
        // `mcp/disconnect` naming that connection. Asserting only "not registered" is what let the
        // leak through: the connection is leaked *inside* the not-registered state, so a test that
        // checks the registry alone asserts the broken state as correct.
        // Bounded with its own message: without it, a regression here waits out the generic
        // `recv` timeout and reports "timed out waiting for a server frame" — which names the
        // harness, not the leak, and reads like a flake.
        let wait_disconnect = async {
            loop {
                let f = recv(&mut ws).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/disconnect") {
                    return f["params"]["connectionId"].as_str().unwrap().to_string();
                }
            }
        };
        let disconnected = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            wait_disconnect,
        )
        .await
        .map(Some)
        .expect(
            "no `mcp/disconnect` after a refused handshake: the connection the client opened for \
             us is leaked — it never entered the registry, and every cleanup path goes through the \
             registry",
        );
        assert_eq!(
            disconnected.as_deref(),
            Some("conn-1"),
            "the connection opened for a server that then refused the handshake must be closed, \
             naming that connection — nothing else can close it, since every other cleanup path \
             goes through the registry it never entered"
        );

        // And it must still not be registered. Poll rather than check once: we are proving
        // something stays absent, so give it real time to appear wrongly.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            assert!(
                registry.lock().unwrap().is_empty(),
                "a server that refused `initialize` was registered anyway — the handshake failure \
                 did not fail the establish"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    /// When connection age and attach order DISAGREE, connection age decides who keeps the name.
    ///
    /// The construction is what matters: an incumbent that is older by connection but LATER by
    /// attach, which happens when the newer connection's establish starts first and then stalls
    /// while the older connection's starts later and completes. Every other same-name test has the
    /// two dimensions agreeing — same-connection ones have equal ages, and the cross-connection one
    /// has the older side also attaching earlier — so none of them can tell the orderings apart.
    ///
    /// Ordering on attach alone gets this backwards: it reads the arriving establish as the older
    /// one, lets it stand down, and leaves the wrong connection holding the name.
    ///
    /// History worth keeping, because it cost two wrong turns. I first mutated the eviction filter,
    /// saw the suite stay green, and wrote into the source that the comparison was "provably inert"
    /// — reading green as "nothing can distinguish this" when it only meant "my tests do not". The
    /// filter has since been simplified away entirely, since everything that should win is already
    /// filtered by the supersede check above, so what this test now pins is that comparison.
    #[tokio::test]
    async fn eviction_follows_connection_age_when_it_disagrees_with_attach_order() {
        let (url, registry) = serve().await;

        // B opens FIRST — older connection — and declares nothing yet.
        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut b).await;
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": {"cwd": "/w", "mcpServers": []}
            }),
        )
        .await;
        let session_id = loop {
            let f = recv(&mut b).await;
            if f.get("id") == Some(&json!(2)) {
                break f["result"]["sessionId"].as_str().unwrap().to_string();
            }
        };

        // C opens SECOND — newer connection — and starts its establish FIRST, then stalls: its
        // `mcp/connect` is captured and deliberately left unanswered, so it takes the LOWER attach
        // number while making no progress.
        let (mut c, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut c).await;
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {"sessionId": session_id.clone(), "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-c", "name": "katashiro"}]}
            }),
        )
        .await;
        let c_connect_id = loop {
            let f = recv(&mut c).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                break f["id"].clone();
            }
        };

        // Now the OLDER connection declares the same name under a different id and completes, so it
        // registers with the HIGHER attach number.
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 9, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-b", "name": "katashiro"}]}
            }),
        )
        .await;
        let mut done = false;
        while !done {
            let f = recv(&mut b).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                send(
                    &mut b,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-b"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut b, &f).await == Some("initialize") {
                done = true;
            }
        }
        wait_for_tunnels(&registry, 1).await;

        // Finally let the stalled, newer-connection establish finish.
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": c_connect_id,
                "result": {"connectionId": "conn-c"}
            }),
        )
        .await;
        loop {
            let f = recv(&mut c).await;
            if handled_inner_lifecycle(&mut c, &f).await == Some("initialize") {
                break;
            }
        }

        // Exactly one tunnel, and it must be the newer connection's.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let ids: Vec<String> = {
                let reg = registry.lock().unwrap();
                reg.keys().map(|(_, id)| id.clone()).collect()
            };
            if ids == vec!["srv-c".to_string()] {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "expected only the newer connection's tunnel, got {ids:?} — the incumbent was older \
                 by connection but later by attach, and attach order alone reads that as 'not older' \
                 and refuses to evict it"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    /// Within ONE connection, the later establish still wins — the attach tiebreak is load-bearing.
    ///
    /// Same-connection ordering tests DO exist — `mod acp_requests` builds handles with a
    /// `connection_generation` of 0 throughout — but every one of them exercises the same direction:
    /// the later establish also finishes later, and there dropping the tiebreak still answers
    /// correctly (equal ages mean nothing supersedes, the same-name eviction is unconditional, and
    /// the later arrival wins anyway). What nothing reaches is the REVERSE direction: started
    /// earlier, finished later. Compare age alone there and the stale establish is neither superseded
    /// nor blocked, so it evicts the successor that already registered and installs itself over it.
    ///
    /// Stated this way on purpose. An earlier draft claimed "every other ordering test is
    /// cross-connection", which is a universal that one same-connection test disproves — and the case
    /// for this test would have appeared to fall with it, though the gap is real either way.
    ///
    /// Deterministic without racing two spawns: the first establish is parked by withholding its
    /// `mcp/connect` answer, the second is driven to completion, and only then is the first released.
    /// Which one started earlier is fixed by the order the resumes were sent.
    #[tokio::test]
    async fn within_one_connection_a_late_finishing_older_establish_loses_to_its_successor() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut ws).await;
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": {"cwd": "/w", "mcpServers": []}
            }),
        )
        .await;
        let session_id = loop {
            let f = recv(&mut ws).await;
            if f.get("id") == Some(&json!(2)) {
                break f["result"]["sessionId"].as_str().unwrap().to_string();
            }
        };

        // First resume: declare srv-1 and PARK it — its `mcp/connect` is captured, not answered, so
        // it holds the lower attach number while making no progress.
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 3, "method": "session/resume",
                "params": {"sessionId": session_id.clone(), "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
            }),
        )
        .await;
        let parked_connect_id = loop {
            let f = recv(&mut ws).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                assert_eq!(f["params"]["acpId"], json!("srv-1"));
                break f["id"].clone();
            }
        };

        // Second resume on the SAME connection: same name, new id, driven to completion.
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 4, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-2", "name": "katashiro"}]}
            }),
        )
        .await;
        let mut registered = false;
        while !registered {
            let f = recv(&mut ws).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect")
                && f["params"]["acpId"] == json!("srv-2")
            {
                send(
                    &mut ws,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-2"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut ws, &f).await == Some("initialize") {
                registered = true;
            }
        }
        wait_for_tunnels(&registry, 1).await;

        // Now release the parked, EARLIER establish.
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": parked_connect_id,
                "result": {"connectionId": "conn-1"}
            }),
        )
        .await;
        loop {
            let f = recv(&mut ws).await;
            if handled_inner_lifecycle(&mut ws, &f).await == Some("initialize") {
                break;
            }
        }

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            let ids: Vec<String> = {
                let reg = registry.lock().unwrap();
                reg.keys().map(|(_, id)| id.clone()).collect()
            };
            assert_eq!(
                ids,
                vec!["srv-2".to_string()],
                "the earlier establish finished last and took the name back ({ids:?}) — within one \
                 connection the ages are equal, so attach order is the only thing that can decide, \
                 and dropping it lets a stale tunnel replace its own successor"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    /// Same declared name, DIFFERENT id, incumbent on the newer connection: the arriving establish
    /// must stand down rather than sit beside it.
    ///
    /// This is the same-name comparison, which the take-over test cannot reach: there the late
    /// resume re-declares the SAME id, so it goes through the own-key check and `same_name` never
    /// sees the incumbent (`id != &acp_id` excludes it). Here the ids differ, so this is the only
    /// site that can refuse it.
    ///
    /// The failure is not a take-over — it is TWO tunnels under one declared name, which is exactly
    /// the ambiguity last-attach-wins exists to remove (ADR §6.1). Ordering on attach alone permits
    /// it: the older connection's late resume carries the higher attach number, so it is neither
    /// superseded nor able to evict, and simply lands alongside.
    #[tokio::test]
    async fn a_same_name_establish_from_an_older_connection_stands_down() {
        let (url, registry) = serve().await;

        // B opens first, so its connection is the OLDER one. It declares nothing yet.
        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut b).await;
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": {"cwd": "/w", "mcpServers": []}
            }),
        )
        .await;
        let session_id = loop {
            let f = recv(&mut b).await;
            if f.get("id") == Some(&json!(2)) {
                break f["result"]["sessionId"].as_str().unwrap().to_string();
            }
        };

        // C opens second (NEWER connection) and establishes srv-3 under the shared name.
        let (mut c, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut c).await;
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {"sessionId": session_id.clone(), "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-3", "name": "katashiro"}]}
            }),
        )
        .await;
        loop {
            let f = recv(&mut c).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                send(
                    &mut c,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-c"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut c, &f).await == Some("initialize") {
                break;
            }
        }
        wait_for_tunnels(&registry, 1).await;

        // The OLDER connection now declares the same NAME under a different id, and completes.
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 9, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-4", "name": "katashiro"}]}
            }),
        )
        .await;
        let mut done = false;
        while !done {
            let f = recv(&mut b).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                send(
                    &mut b,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-b"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut b, &f).await == Some("initialize") {
                done = true;
            }
        }

        // Poll: the wrong outcome is an EXTRA entry appearing, so give it time to appear.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            let names: Vec<String> = {
                let reg = registry.lock().unwrap();
                reg.values().map(|h| h.server_name().to_string()).collect()
            };
            assert_eq!(
                names.len(),
                1,
                "two tunnels are registered under one declared name ({names:?}) — an establish from \
                 an OLDER connection neither stood down nor evicted, because attach order alone \
                 ranks it above the incumbent it arrived after"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        // And it must be the newer connection's tunnel that survived.
        let ids: Vec<String> = {
            let reg = registry.lock().unwrap();
            reg.keys().map(|(_, id)| id.clone()).collect()
        };
        assert_eq!(
            ids,
            vec!["srv-3".to_string()],
            "the newer connection's tunnel must hold the name"
        );
    }

    /// An older connection's late resume must not TAKE OVER a newer connection's tunnel either.
    ///
    /// The sibling test covers the sweep path, where the older resume withdraws what it never knew
    /// about. This covers the establish path, which needed the same fix and did not get it: resume
    /// re-spawns an establish for every declared server without checking whether that
    /// `(channel, id)` is already live, and that establish is stamped when it STARTS — so the older
    /// connection's late one carries the HIGHER attach number, for the same reason its resume ran
    /// later. Ordering on attach alone therefore lets it replace the incumbent and disconnect a
    /// connection that is newer than itself.
    ///
    /// The difference from the sibling is only which id the late resume names: there it declared
    /// something the newer connection did not hold, so nothing collided. Here it declares exactly
    /// what the newer connection holds, which is the case a stable-id client produces on every
    /// reconnect.
    #[tokio::test]
    async fn an_older_connections_late_resume_does_not_take_over_a_newer_connections_tunnel() {
        let (url, registry) = serve().await;

        // Connection B (older) opens the session but establishes nothing yet.
        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut b).await;
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": {"cwd": "/w", "mcpServers": []}
            }),
        )
        .await;
        let session_id = loop {
            let f = recv(&mut b).await;
            if f.get("id") == Some(&json!(2)) {
                break f["result"]["sessionId"].as_str().unwrap().to_string();
            }
        };

        // Connection C (newer) resumes and establishes srv-1.
        let (mut c, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut c).await;
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {"sessionId": session_id.clone(), "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
            }),
        )
        .await;
        loop {
            let f = recv(&mut c).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                send(
                    &mut c,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-c"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut c, &f).await == Some("initialize") {
                break;
            }
        }
        wait_for_tunnels(&registry, 1).await;

        // The OLDER connection now resumes declaring THE SAME id, and answers its handshake fully.
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 9, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
            }),
        )
        .await;
        let mut answered = false;
        while !answered {
            let f = recv(&mut b).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                send(
                    &mut b,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-b"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut b, &f).await == Some("initialize") {
                answered = true;
            }
        }

        // C must keep the slot: it is the newer connection. Before the fix B took it over and C was
        // disconnected, so the discriminating check is that C — not B — is never told to disconnect.
        let stolen = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let f = recv(&mut c).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/disconnect") {
                    return f["params"]["connectionId"]
                        .as_str()
                        .unwrap_or("?")
                        .to_string();
                }
            }
        })
        .await;
        assert!(
            stolen.is_err(),
            "an older connection's late resume replaced a NEWER connection's live tunnel and \
             disconnected it ({:?}) — the establish path orders by attach number alone, which the \
             late resume wins precisely because it ran late",
            stolen.ok()
        );
        assert_eq!(
            registry.lock().unwrap().len(),
            1,
            "exactly one tunnel must hold the slot"
        );
    }

    /// An older connection's late resume must not retire a NEWER connection's tunnel.
    ///
    /// The withdrawn set is "registered under this channel, minus what the client just declared".
    /// That is only sound if the declaration is current. An older connection whose resume is
    /// processed late carries an out-of-date view: its silence about a server a newer connection
    /// established is not a withdrawal, it simply never knew about it.
    ///
    /// Authorising the sweep by connection age is what expresses that. Stamping the RESUME instead
    /// measures the wrong thing and cannot fix this case — the late resume takes the higher number
    /// precisely because it ran last, so it would still outrank the newer connection it must not
    /// touch. Both reviewers and I initially proposed exactly that, and it fails here.
    #[tokio::test]
    async fn an_older_connections_late_resume_does_not_retire_a_newer_connections_tunnel() {
        let (url, registry) = serve().await;

        // Connection B (older) establishes srv-2 and stays open.
        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        let session_id = handshake(&mut b, "srv-2", "katashiro", "conn-b").await;
        wait_for_tunnels(&registry, 1).await;

        // Connection C (newer) resumes the same session and adds srv-3 under a different name.
        let (mut c, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut c).await;
        send(
            &mut c,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {"sessionId": session_id.clone(), "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-2", "name": "katashiro"},
                                          {"type": "acp", "id": "srv-3", "name": "notes"}]}
            }),
        )
        .await;
        loop {
            let f = recv(&mut c).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect")
                && f["params"]["acpId"] == json!("srv-3")
            {
                send(
                    &mut c,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-c"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut c, &f).await == Some("initialize") {
                break;
            }
        }
        wait_for_tunnels(&registry, 2).await;

        // Now the OLDER connection resumes, still declaring only what it knew about.
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 9, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-2", "name": "katashiro"}]}
            }),
        )
        .await;

        // srv-3 belongs to a newer connection and must survive. Poll: a wrongful retire is async.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            let ids: std::collections::HashSet<String> = {
                let reg = registry.lock().unwrap();
                reg.keys().map(|(_, id)| id.clone()).collect()
            };
            assert!(
                ids.contains("srv-3"),
                "an older connection's late resume retired a tunnel a NEWER connection had \
                 established — the sweep was authorised by resume order instead of connection age, \
                 leaving: {ids:?}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    /// A resume that OMITS `mcpServers` withdraws nothing.
    ///
    /// Absent and empty are different statements. Omitting the optional field says nothing about
    /// the client's servers; an explicit `[]` says it now offers none. Conflating them was
    /// harmless while the withdrawn set was always empty, but deriving that set from the registry
    /// made absence the most destructive reading available — a compliant client that simply left
    /// the field out would have every tunnel on its channel torn down. Elsewhere absence is read
    /// fail-closed (a missing `protocolVersion` refuses the establish); it should not be the most
    /// damaging reading here.
    #[tokio::test]
    async fn a_resume_that_omits_mcp_servers_withdraws_nothing() {
        let (url, registry) = serve().await;
        let (mut a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        let session_id = handshake(&mut a, "srv-1", "katashiro", "conn-1").await;
        wait_for_tunnels(&registry, 1).await;

        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut b).await;
        // No `mcpServers` key at all.
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w"}
            }),
        )
        .await;
        let resumed = recv(&mut b).await;
        assert!(resumed.get("result").is_some(), "resume failed: {resumed}");

        // The other shapes an "omitted" field takes on the wire, pinned as REJECTIONS rather than
        // as sweeps. A serde `Option<Vec<_>>` without `skip_serializing_if` emits `null`, and a
        // guard written as `is_some()` would accept that as a declaration with an empty list — but
        // schema validation runs first and refuses anything that is not a sequence, so the
        // destructive path is unreachable from the wire. This records that, because the guard below
        // reads as if it were the only thing standing between `null` and a full sweep, and the next
        // person to relax the schema needs the two facts in one place.
        for shape in [json!(null), json!({}), json!("nonsense")] {
            send(
                &mut b,
                json!({
                    "jsonrpc": "2.0", "id": 3, "method": "session/resume",
                    "params": {"sessionId": session_id, "cwd": "/w", "mcpServers": shape}
                }),
            )
            .await;
            let r = recv(&mut b).await;
            assert!(
                r.get("result").is_some() || r.get("error").is_some(),
                "no reply: {r}"
            );
        }

        // The tunnel must stay. Poll, because a wrongful teardown is asynchronous.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            assert_eq!(
                registry.lock().unwrap().len(),
                1,
                "a resume that never mentioned mcpServers tore down the session's tunnels — \
                 absence was read as 'the client withdrew everything'"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    /// A resume that RE-DECLARES an already-registered id must not have that tunnel SWEPT.
    ///
    /// Scope deliberately narrow, because the system does not leave the tunnel alone: resume then
    /// spawns an establish for every declared server without checking whether that
    /// `(channel, id)` is already registered, so the re-declared one is replaced through the
    /// own-key path and its predecessor is disconnected. The churn is real and is tracked
    /// separately; what this test pins is only that the SWEEP does not take it.
    ///
    /// It is green for that reason and not because the tunnel survives end to end — the second
    /// `mcp/connect` is never answered here, so the replacement cannot complete inside the window.
    /// Worth stating plainly: withholding a trigger is exactly why the two tests this one was
    /// written to supplement looked like they had coverage.
    ///
    /// This is what pins the withdrawn set to "registered MINUS declared". Both neighbouring
    /// withdrawal tests survive a mutation that simply sweeps the whole channel on every resume:
    /// one declares `[]` so its `keep` is empty either way, and the other re-declares under a NEW
    /// id, so the tunnel a sweep would wrongly remove was going to be evicted by last-attach-wins
    /// anyway and the end state matches. Only re-declaring the SAME id makes the difference
    /// observable — the tunnel must not be disconnected and rebuilt, which for a client with
    /// stable ids would mean a spurious `mcp/disconnect` and a gap on every single resume.
    #[tokio::test]
    async fn a_resume_redeclaring_the_same_id_leaves_its_tunnel_untouched() {
        let (url, registry) = serve().await;
        let (mut a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        let session_id = handshake(&mut a, "srv-1", "katashiro", "conn-1").await;
        wait_for_tunnels(&registry, 1).await;

        // Same connection, same id, re-declared.
        send(
            &mut a,
            json!({
                "jsonrpc": "2.0", "id": 3, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
            }),
        )
        .await;

        // Nothing may be disconnected. A sweep-everything implementation retires conn-1 here and
        // then re-establishes it, which this catches; the correct implementation sends no
        // `mcp/disconnect` at all, so a short quiet window is the assertion.
        let quiet = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let f = recv(&mut a).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/disconnect") {
                    return f["params"]["connectionId"]
                        .as_str()
                        .unwrap_or("?")
                        .to_string();
                }
            }
        })
        .await;
        assert!(
            quiet.is_err(),
            "a resume that re-declared the SAME id disconnected its tunnel ({:?}) — the withdrawn \
             set is not 'registered minus declared', it is 'everything'",
            quiet.ok()
        );
        assert_eq!(
            registry.lock().unwrap().len(),
            1,
            "the tunnel must still be registered"
        );
    }

    /// A resume on a NEW connection that stops declaring a server retires its tunnel.
    ///
    /// This is the path the withdrawal feature was written for and the one it could never take.
    /// The old implementation compared the new declarations against `sessions`, which is built
    /// inside `handle_acp_connection` — per connection. A reconnect arrives on a fresh socket with
    /// an empty map, so the lookup returned None and the withdrawn set was always empty. The
    /// existing coverage drove a same-connection resume, where the map IS populated, so it passed
    /// while the feature did nothing on the only path that matters.
    ///
    /// Deriving the set from the registry — process-global, keyed `(channel_id, server_id)` — is
    /// what makes this case work, and it is why the fix removes state rather than adding it.
    #[tokio::test]
    async fn a_reconnect_that_withdraws_a_declaration_retires_its_tunnel() {
        let (url, registry) = serve().await;

        // Connection 1: declare and fully establish one server.
        let (mut a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        // `handshake` already drives the whole inner lifecycle, including `notifications/
        // initialized`, so nothing further is owed on this socket before the tunnel is registered.
        let session_id = handshake(&mut a, "srv-1", "katashiro", "conn-1").await;
        wait_for_tunnels(&registry, 1).await;

        // Connection 2 — a genuine reconnect — resumes the same session declaring NOTHING.
        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut b).await;
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w", "mcpServers": []}
            }),
        )
        .await;
        let resumed = recv(&mut b).await;
        assert!(resumed.get("result").is_some(), "resume failed: {resumed}");

        // The tunnel must go. Bounded with its own message: before the fix the registry simply
        // kept the entry, and a bare `wait_for_tunnels(0)` would report only a count.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if registry.lock().unwrap().is_empty() {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "a reconnect withdrew every declaration and the tunnel stayed registered — the \
                 withdrawn set was derived from per-connection session state, which a reconnect \
                 never populates"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        // And the original connection is owed its `mcp/disconnect`, on ITS socket.
        let wait_disconnect = async {
            loop {
                let f = recv(&mut a).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/disconnect") {
                    return f["params"]["connectionId"].as_str().unwrap().to_string();
                }
            }
        };
        let disconnected =
            tokio::time::timeout(std::time::Duration::from_secs(10), wait_disconnect)
                .await
                .expect("a withdrawn tunnel was dropped without disconnecting its connection");
        assert_eq!(disconnected, "conn-1");
    }

    /// A slow establish that STARTED first must not evict the newer tunnel that beat it to the
    /// registry.
    ///
    /// The failing case is cross-connection by construction, which is why a per-connection
    /// sequence number could not have fixed it: a reconnecting client arrives on a NEW socket and
    /// mints a fresh `server_id`, so the two establishes racing for one declared name belong to
    /// different connections. Here socket A declares `katashiro` and then stalls — its
    /// `mcp/connect` is deliberately left unanswered — while socket B resumes the same session,
    /// declares the same name, and completes. When A finally finishes it is the OLDER attach, and
    /// before the generation stamp it would have evicted B and installed the stale tunnel over the
    /// live one.
    ///
    /// Ordering is stamped at establish start rather than at registration for exactly this reason:
    /// registration order is finish order, and finish order inverts whenever handshake durations
    /// differ.
    #[tokio::test]
    async fn a_late_finishing_older_establish_does_not_evict_its_successor() {
        let (url, registry) = serve().await;

        // Socket A: declare `katashiro` as srv-1, then STALL — do not answer its `mcp/connect`.
        let (mut a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut a,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut a).await;
        send(&mut a, json!({
            "jsonrpc": "2.0", "id": 2, "method": "session/new",
            "params": {"cwd": "/w", "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
        })).await;

        let mut session_id = None;
        let mut a_connect_id = None;
        while session_id.is_none() || a_connect_id.is_none() {
            let f = recv(&mut a).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                assert_eq!(f["params"]["acpId"], json!("srv-1"));
                a_connect_id = Some(f["id"].clone());
            } else if f.get("id") == Some(&json!(2)) {
                session_id = Some(f["result"]["sessionId"].as_str().unwrap().to_string());
            }
        }
        let session_id = session_id.unwrap();

        // Socket B: resume the SAME session — same channel — declaring the same name as srv-2, and
        // carry it all the way to registered. This is the newer attach.
        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut b).await;
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {"sessionId": session_id, "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-2", "name": "katashiro"}]}
            }),
        )
        .await;
        loop {
            let f = recv(&mut b).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                send(
                    &mut b,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-new"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut b, &f).await == Some("initialize") {
                break;
            }
        }
        wait_for_tunnels(&registry, 1).await;

        // Now let the OLDER establish finish.
        send(
            &mut a,
            json!({
                "jsonrpc": "2.0", "id": a_connect_id.unwrap(),
                "result": {"connectionId": "conn-old"}
            }),
        )
        .await;
        loop {
            let f = recv(&mut a).await;
            if handled_inner_lifecycle(&mut a, &f).await == Some("initialize") {
                break;
            }
        }

        // The newer tunnel must still be the registered one. Poll: we are proving the late arrival
        // never displaces it, and it would do so asynchronously.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            let ids: Vec<String> = {
                let reg = registry.lock().unwrap();
                reg.keys().map(|(_, id)| id.clone()).collect()
            };
            assert_eq!(
                ids,
                vec!["srv-2".to_string()],
                "the older establish finished last and displaced its successor — attach order was \
                 taken from registration order instead of the generation stamp"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        // And the establish that stood down owes ITS client a disconnect. Asserting only "the
        // right tunnel is registered" is what let the equivalent leak through on the refusal path:
        // the losing connection never enters the registry, so no cleanup path can ever reach it.
        // Without this, deleting the whole `tokio::spawn(disconnect)` in the `Superseded` arm
        // leaves this test green.
        let wait_disconnect = async {
            loop {
                let f = recv(&mut a).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/disconnect") {
                    return f["params"]["connectionId"].as_str().unwrap().to_string();
                }
            }
        };
        let disconnected =
            tokio::time::timeout(std::time::Duration::from_secs(10), wait_disconnect)
                .await
                .expect(
                    "the superseded establish never disconnected the connection it opened — it is \
                     not in the registry, so nothing else can close it",
                );
        assert_eq!(disconnected, "conn-old");
    }

    /// A client that REUSES its `server_id` across a reconnect must still be ordered.
    ///
    /// The same-name predicate deliberately excludes the attaching key (`id != &acp_id`), so when
    /// both establishes carry the same `server_id` they land on one registry key and that
    /// predicate never sees the newer entry. The older arrival would then `insert` straight over a
    /// live handle — and because the old `insert` return value was discarded, the displaced
    /// connection left the registry with no cleanup path while its client still believed it was
    /// open. Ordering has to hold per key, not just per declared name.
    ///
    /// Reusing a stable id is not a client bug. Nothing in the protocol requires a fresh one; the
    /// "mints a new id per connection" assumption holds for our own extension, and the deliverable
    /// here is a GENERIC compliant peer.
    #[tokio::test]
    async fn a_reconnect_reusing_the_same_server_id_is_still_ordered() {
        let (url, registry) = serve().await;

        // Socket A declares srv-1 and stalls with its `mcp/connect` unanswered.
        let (mut a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut a,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut a).await;
        send(&mut a, json!({
            "jsonrpc": "2.0", "id": 2, "method": "session/new",
            "params": {"cwd": "/w", "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
        })).await;
        let mut session_id = None;
        let mut a_connect_id = None;
        while session_id.is_none() || a_connect_id.is_none() {
            let f = recv(&mut a).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                a_connect_id = Some(f["id"].clone());
            } else if f.get("id") == Some(&json!(2)) {
                session_id = Some(f["result"]["sessionId"].as_str().unwrap().to_string());
            }
        }

        // Socket B reconnects and re-declares THE SAME id, completing fully.
        let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut b).await;
        send(
            &mut b,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {"sessionId": session_id.unwrap(), "cwd": "/w",
                           "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
            }),
        )
        .await;
        loop {
            let f = recv(&mut b).await;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                send(
                    &mut b,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": "conn-new"}
                    }),
                )
                .await;
            } else if handled_inner_lifecycle(&mut b, &f).await == Some("initialize") {
                break;
            }
        }
        wait_for_tunnels(&registry, 1).await;

        // Now let the OLDER establish finish, on the same key.
        send(
            &mut a,
            json!({
                "jsonrpc": "2.0", "id": a_connect_id.unwrap(),
                "result": {"connectionId": "conn-old"}
            }),
        )
        .await;
        loop {
            let f = recv(&mut a).await;
            if handled_inner_lifecycle(&mut a, &f).await == Some("initialize") {
                break;
            }
        }

        // It must stand down and close its own connection. Before the fix it silently overwrote
        // the live handle instead, and `conn-old` was never disconnected because it believed it
        // had won — so this wait is what distinguishes the two.
        let wait_disconnect = async {
            loop {
                let f = recv(&mut a).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/disconnect") {
                    return f["params"]["connectionId"].as_str().unwrap().to_string();
                }
            }
        };
        let disconnected = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            wait_disconnect,
        )
        .await
        .expect(
            "an older establish reusing the same server_id overwrote the newer live handle \
                     instead of standing down — same-key ordering is not enforced",
        );
        assert_eq!(disconnected, "conn-old");
        assert_eq!(
            registry.lock().unwrap().len(),
            1,
            "exactly one tunnel must remain"
        );
    }

    /// A server that *succeeds* at `initialize` but answers a protocol version we do not speak
    /// must not be registered either.
    ///
    /// Distinct from the refusal test in the one way that matters: there is no JSON-RPC `error`
    /// here. The handshake completes, so every check that only asks "did a reply arrive" passes —
    /// which is exactly why the version went unchecked. The gateway used to discard this result
    /// entirely, register the tunnel, and fail on the first real `tools/call` with nothing in the
    /// log to explain it.
    ///
    /// The mock answered the supported version everywhere, so the happy path was the only path the
    /// suite could reach and an absent check passed.
    ///
    /// "Unsupported" means outside `SUPPORTED_INNER_MCP_PROTOCOL_VERSIONS`, which since R5 holds
    /// three revisions rather than one — being older than what we request is no longer sufficient.
    #[tokio::test]
    async fn a_server_answering_an_unsupported_protocol_version_is_not_registered() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut ws).await;
        send(&mut ws, json!({
            "jsonrpc": "2.0", "id": 2, "method": "session/new",
            "params": {"cwd": "/w", "mcpServers": [{"type": "acp", "id": "srv-1", "name": "katashiro"}]}
        })).await;

        // Answer `mcp/connect`, then answer `initialize` SUCCESSFULLY with a revision outside the
        // accepted set.
        //
        // This used to be `2024-11-05`, chosen because a real MCP revision makes a more plausible
        // peer than a nonsense string. R5 then ADDED that revision to
        // `SUPPORTED_INNER_MCP_PROTOCOL_VERSIONS`, so the literal quietly became a SUPPORTED
        // version and this test began asserting the opposite of the decided behaviour. Picking a
        // realistic example coupled the test to the policy it was meant to be independent of.
        //
        // `2019-01-01` is well-formed and deliberately not a real revision, so extending the set
        // cannot silently invert this test again. If it is ever added, that is a decision someone
        // has to make explicitly.
        let mut answered = false;
        while !answered {
            let f = recv(&mut ws).await;
            match f.get("method").and_then(Value::as_str) {
                Some("mcp/connect") => {
                    send(
                        &mut ws,
                        json!({
                            "jsonrpc": "2.0", "id": f["id"].clone(),
                            "result": {"connectionId": "conn-1"}
                        }),
                    )
                    .await;
                }
                Some("mcp/message") if f["params"]["method"] == json!("initialize") => {
                    send(
                        &mut ws,
                        json!({
                            "jsonrpc": "2.0", "id": f["id"].clone(),
                            "result": {
                                "protocolVersion": "2019-01-01",
                                "capabilities": { "tools": {} },
                                "serverInfo": { "name": "old-ext", "version": "0" }
                            }
                        }),
                    )
                    .await;
                    answered = true;
                }
                _ => {}
            }
        }

        // Registry first, deliberately. Both obligations below fail when the version check is
        // missing, but only this one NAMES that: delete the check and the tunnel is registered and
        // genuinely in use, so leading with the disconnect assertion reports a leaked connection —
        // a different defect, which is not actually present. A failing test that names the wrong
        // cause costs more than one that names none.
        // Poll rather than check once: we are proving something stays absent.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            assert!(
                registry.lock().unwrap().is_empty(),
                "a server answering an unsupported protocolVersion was registered anyway — the \
                 version check did not fail the establish"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        // The connection the client opened for us is still owed an `mcp/disconnect`: it never
        // entered the registry, and every cleanup path goes through the registry. Bounded with its
        // own message so a regression names the defect rather than the harness.
        let wait_disconnect = async {
            loop {
                let f = recv(&mut ws).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/disconnect") {
                    return f["params"]["connectionId"].as_str().unwrap().to_string();
                }
            }
        };
        let disconnected =
            tokio::time::timeout(std::time::Duration::from_secs(10), wait_disconnect)
                .await
                .expect(
                    "no `mcp/disconnect` after a version mismatch: the connection opened for a \
                     server we then rejected is leaked",
                );
        assert_eq!(
            disconnected, "conn-1",
            "the connection opened for a server whose protocol version we rejected must be closed, \
             naming that connection"
        );
    }

    /// A real `mcp/message` crosses the socket and its result comes back to the caller.
    #[tokio::test]
    async fn a_tool_call_crosses_the_real_socket_and_returns_its_result() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        handshake(&mut ws, "uuid-1", "katashiro", "conn-1").await;
        wait_for_tunnels(&registry, 1).await;

        // Server side, exactly as core reaches a session's tunnel.
        let handle = {
            let reg = registry.lock().unwrap();
            reg.values()
                .next()
                .expect("a tunnel must be registered")
                .clone()
        };
        let call = tokio::spawn(async move {
            handle
                .mcp_message("tools/call", Some(json!({"name": "katashiro.click"})), 5)
                .await
        });

        let framed = recv(&mut ws).await;
        assert_eq!(framed["method"], json!("mcp/message"));
        assert_eq!(framed["params"]["connectionId"], json!("conn-1"));
        assert_eq!(framed["params"]["method"], json!("tools/call"));
        assert_eq!(framed["params"]["params"]["name"], json!("katashiro.click"));

        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": framed["id"].clone(),
                "result": {"content": [{"type": "text", "text": "clicked"}]}
            }),
        )
        .await;

        let got = call.await.unwrap().expect("the call must succeed");
        assert_eq!(got["content"][0]["text"], json!("clicked"));
    }

    /// The error half: a JSON-RPC error from the client surfaces as `Err`, not as a null result.
    /// Asserting only the happy path would let a handler that swallows errors pass.
    #[tokio::test]
    async fn an_error_from_the_client_surfaces_as_an_error_not_an_empty_result() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        handshake(&mut ws, "uuid-2", "katashiro", "conn-2").await;
        wait_for_tunnels(&registry, 1).await;

        let handle = {
            let reg = registry.lock().unwrap();
            reg.values().next().unwrap().clone()
        };
        let call = tokio::spawn(async move { handle.mcp_message("tools/call", None, 5).await });

        let framed = recv(&mut ws).await;
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": framed["id"].clone(),
                "error": {"code": -32603, "message": "no active tab"}
            }),
        )
        .await;

        let err = call
            .await
            .unwrap()
            .expect_err("a remote error must not read as success");
        assert!(
            err.contains("no active tab"),
            "the client's message must reach the caller, got: {err}"
        );
    }

    /// A tunnelled request that times out tells the peer, instead of just giving up quietly.
    ///
    /// Dropping the pending entry ends only OUR wait. The extension is still running the request
    /// and still holding whatever it holds — a tab, a navigation, a script — and without a
    /// cancellation it has no way to learn that nobody is listening. That is work and state
    /// stranded on the peer for every timeout.
    #[tokio::test]
    async fn a_timed_out_tunnel_request_cancels_itself_on_the_peer() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        handshake(&mut ws, "srv-1", "katashiro", "conn-1").await;
        wait_for_tunnels(&registry, 1).await;

        let handle = {
            let reg = registry.lock().unwrap();
            reg.values().next().unwrap().clone()
        };
        // One second, and deliberately never answered.
        let call = tokio::spawn(async move { handle.mcp_message("tools/call", None, 1).await });

        let request = recv(&mut ws).await;
        let request_id = request["id"].clone();
        assert_eq!(request["method"], json!("mcp/message"));

        let cancel = tokio::time::timeout(std::time::Duration::from_secs(10), recv(&mut ws))
            .await
            .expect(
                "no `mcp/cancel` after the request timed out — the peer is still working on a \
                 request nobody is waiting for",
            );
        assert_eq!(cancel["method"], json!("mcp/cancel"));
        assert_eq!(
            cancel["params"]["requestId"], request_id,
            "the cancellation must name the request it cancels, or the peer cannot tell which of \
             several in-flight requests to abandon"
        );
        assert!(
            cancel.get("id").is_none(),
            "a cancellation is a notification: giving it an `id` would oblige a reply nobody reads"
        );

        let err = call
            .await
            .unwrap()
            .expect_err("a timed-out call must not read as success");
        assert!(err.contains("timed out"), "got: {err}");
    }

    /// A prompt must not be refused because tunnels are still establishing.
    ///
    /// The two used to share `prompt_tasks` and `MAX_INFLIGHT_PROMPTS`, so a client with enough
    /// slow `mcp/connect`s outstanding got "Too many in-flight prompts" — a limit it had not
    /// reached, for work it had not asked for.
    ///
    /// It takes **more than `MAX_INFLIGHT_PROMPTS` parked establishes** to reach the old bug, and
    /// one session cannot supply them: `MAX_ACP_SERVERS_PER_SESSION` is 8 against a prompt cap of
    /// 32. A first version of this test used a single session, so it passed against the shared
    /// budget too and proved nothing. Hence several sessions.
    #[tokio::test]
    async fn pending_tunnel_establishes_do_not_consume_the_prompt_budget() {
        let (url, _registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut ws).await;

        // Enough sessions to park strictly more than MAX_INFLIGHT_PROMPTS establishes.
        //
        // There used to be an `assert!(want_connects > MAX_INFLIGHT_PROMPTS)` here. `want_connects`
        // is DERIVED from the cap two lines above, so that assertion restated the integer-division
        // identity `(P/S + 1) * S = P - (P % S) + S > P`, which holds for every positive P and S.
        // It could not fire for any value of either constant — it looked like a guard on the
        // test's premise and guarded nothing. What can actually go wrong is the server not parking
        // the establishes we asked for, so the premise is checked below against the count the
        // socket really delivered.
        let sessions_needed = MAX_INFLIGHT_PROMPTS / MAX_ACP_SERVERS_PER_SESSION + 1;
        let want_connects = sessions_needed * MAX_ACP_SERVERS_PER_SESSION;

        let mut last_session = None;
        let mut connects = 0;
        let mut answered_new = 0;
        for n in 0..sessions_needed {
            let req_id = 100 + n as i64;
            let servers: Vec<Value> = (0..MAX_ACP_SERVERS_PER_SESSION)
                .map(|i| json!({"type": "acp", "id": format!("s{n}-{i}"), "name": format!("n{n}-{i}")}))
                .collect();
            send(
                &mut ws,
                json!({
                    "jsonrpc": "2.0", "id": req_id, "method": "session/new",
                    "params": {"cwd": "/w", "mcpServers": servers}
                }),
            )
            .await;
            // Collect this session's response; mcp/connect frames are observed and NEVER answered,
            // which is what keeps each establish task in flight.
            let mut got_resp = false;
            while !got_resp {
                let f = recv(&mut ws).await;
                if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                    connects += 1;
                } else if f.get("id") == Some(&json!(req_id)) {
                    last_session = Some(f["result"]["sessionId"].as_str().unwrap().to_string());
                    answered_new += 1;
                    got_resp = true;
                }
            }
        }
        assert_eq!(answered_new, sessions_needed);

        // Drain any remaining mcp/connect frames so the parked count is what we think it is.
        // Bounded: if the server parks fewer than we declared, this must fail naming the count,
        // not sit in `recv` until its 30s guard panics. A failure named after the harness reads
        // as a flake and gets dismissed; one naming the count points at the defect.
        let mut frames = 0;
        while connects < want_connects && frames < want_connects * 4 {
            let f = recv(&mut ws).await;
            frames += 1;
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                connects += 1;
            }
        }
        assert!(
            connects > MAX_INFLIGHT_PROMPTS,
            "the budget defect is only observable with more than MAX_INFLIGHT_PROMPTS \
             ({MAX_INFLIGHT_PROMPTS}) establishes parked, but only {connects} were"
        );

        // With >32 establishes parked, a prompt must still be accepted.
        send(&mut ws, json!({
            "jsonrpc": "2.0", "id": 3, "method": "session/prompt",
            "params": {"sessionId": last_session.unwrap(), "prompt": [{"type": "text", "text": "hi"}]}
        })).await;

        let mut saw = None;
        for _ in 0..40 {
            let f = recv(&mut ws).await;
            if f.get("id") == Some(&json!(3)) {
                saw = Some(f);
                break;
            }
        }
        let f = saw.expect("no response to the prompt");

        // The prompt is expected to pass the in-flight budget gate and then fail at the backend,
        // because this harness attaches none. That specific error IS the evidence: the budget gate
        // rejects earlier and with a different message.
        //
        // READ THIS BEFORE LOOSENING THE ASSERTION. The pinned string carries two different
        // things, and only one of them is a contract:
        //
        //   (a) `No agent backend connected` is INCIDENTAL — an artifact of this harness having no
        //       backend. It is not what the test protects.
        //   (b) That the prompt got far enough to fail there AT ALL is the property: establish
        //       tasks and prompt tasks hold separate budgets.
        //
        // So if a harness change makes this red, the fix is to RE-DERIVE what "reached the
        // backend" now looks like and pin that — not to relax the check back toward
        // `!msg.contains("in-flight prompts")`. That substring form is what this replaced, and it
        // would pass for every other error and for any rewording of the budget message: it could
        // only ever fail for one spelling of one regression.
        //
        // Pinned exactly, not asserted as `!msg.contains("in-flight prompts")`. A negative
        // substring check is satisfied by every OTHER error too — a session-not-found, a params
        // error, or the budget message itself once someone rewords it — so it could only ever fail
        // for one spelling of one regression, and would pass silently through the rest.
        let err = f.get("error").unwrap_or_else(|| {
            panic!("the prompt must reach the backend and fail there, got: {f}")
        });
        assert_eq!(
            err["message"],
            json!("No agent backend connected"),
            "{connects} parked mcp/connects must not spend the prompt budget; the prompt must \
             reach the backend and fail only for the missing backend, got: {f}"
        );
    }

    /// A resume that stops declaring a server must retire its tunnel.
    ///
    /// Driven through the real read loop on purpose. The defect this covers was that
    /// `handle_session_resume` re-parsed the raw params and stored an uncapped list while the
    /// tunnels were opened from the accepted one — a unit test of `accept_acp_servers` alone sees
    /// neither half of that, which is how it survived the last review.
    #[tokio::test]
    async fn a_resume_that_withdraws_a_declaration_retires_its_tunnel() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

        // Declare TWO servers, answer both mcp/connect calls.
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut ws).await;
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": {"cwd": "/w", "mcpServers": [
                    {"type": "acp", "id": "keep-1", "name": "katashiro"},
                    {"type": "acp", "id": "drop-1", "name": "other"}
                ]}
            }),
        )
        .await;
        // Two servers: two `mcp/connect`s AND two lifecycle pairs (initialize + notification).
        // Exiting on the connects alone leaves the handshakes unread and both establishes fail.
        let mut session_id = None;
        let mut connects = 0;
        let mut lifecycle = 0;
        while session_id.is_none() || connects < 2 || lifecycle < 4 {
            let f = recv(&mut ws).await;
            if handled_inner_lifecycle(&mut ws, &f).await.is_some() {
                lifecycle += 1;
                continue;
            }
            if f.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                let acp_id = f["params"]["acpId"].as_str().unwrap().to_string();
                send(
                    &mut ws,
                    json!({
                        "jsonrpc": "2.0", "id": f["id"].clone(),
                        "result": {"connectionId": format!("conn-{acp_id}")}
                    }),
                )
                .await;
                connects += 1;
            } else if f.get("id") == Some(&json!(2)) {
                session_id = Some(f["result"]["sessionId"].as_str().unwrap().to_string());
            }
        }
        wait_for_tunnels(&registry, 2).await;

        // Resume declaring ONLY the first — "other" is withdrawn.
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 3, "method": "session/resume",
                "params": {
                    "sessionId": session_id.unwrap(),
                    "cwd": "/w",
                    "mcpServers": [{"type": "acp", "id": "keep-2", "name": "katashiro"}]
                }
            }),
        )
        .await;

        // TWO disconnects are owed here, for different reasons, and both are correct:
        //   - `conn-drop-1` because the resume WITHDREW that declaration (this item), and
        //   - `conn-keep-1` because the resume re-declared the same NAME with a fresh id, so
        //     last-attach-wins evicts the stale tunnel (R7).
        // Asserting on whichever arrives first tests the scheduler, not the behaviour.
        let mut disconnected: Vec<String> = Vec::new();
        let mut reconnected = false;
        let mut relifecycle = 0;
        while disconnected.len() < 2 || !reconnected || relifecycle < 2 {
            let f = recv(&mut ws).await;
            if handled_inner_lifecycle(&mut ws, &f).await.is_some() {
                relifecycle += 1;
                continue;
            }
            match f.get("method").and_then(Value::as_str) {
                Some("mcp/disconnect") => {
                    disconnected.push(f["params"]["connectionId"].as_str().unwrap().to_string());
                }
                Some("mcp/connect") => {
                    send(
                        &mut ws,
                        json!({
                            "jsonrpc": "2.0", "id": f["id"].clone(),
                            "result": {"connectionId": "conn-keep-2"}
                        }),
                    )
                    .await;
                    reconnected = true;
                }
                _ => {}
            }
        }
        disconnected.sort();
        assert_eq!(
            disconnected,
            vec!["conn-drop-1".to_string(), "conn-keep-1".to_string()],
            "the withdrawn declaration AND the superseded same-name tunnel are both owed a \
             disconnect; nothing else may be"
        );

        // Only the re-declared server survives: `drop-1` was withdrawn and `keep-1` superseded.
        wait_for_tunnels(&registry, 1).await;
        let keys: Vec<String> = {
            let reg = registry.lock().unwrap();
            reg.keys().map(|(_, id)| id.clone()).collect()
        };
        assert_eq!(
            keys,
            vec!["keep-2".to_string()],
            "the withdrawn declaration must not stay reachable, got {keys:?}"
        );
    }

    /// The transport ceiling: a frame over `MAX_FRAME_BYTES` closes the connection.
    ///
    /// Deliberately paired with the test below, because the two ceilings have DIFFERENT outcomes
    /// and a single test cannot show that. Over 8 MiB the frame cannot be parsed at all, so the
    /// gateway cannot tell a request from a notification or recover an id — fabricating a response
    /// would risk answering a notification, so it closes instead.
    ///
    /// `scripts/acp-ws-smoke.py` asserted this with a 1 MiB + 64 byte payload and a comment
    /// reading `> MAX_FRAME_BYTES (1 MiB)`. The ceiling moved to 8 MiB, so that payload stopped
    /// reaching it — and because the payload was a bare `x` string rather than JSON, the close it
    /// still observed came from the parse path. The assertion kept passing while covering a
    /// different mechanism, which is why this now lives here where the gate runs it.
    #[tokio::test]
    async fn a_frame_over_the_transport_ceiling_closes_the_connection() {
        let (url, _registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        let oversized = "x".repeat(super::MAX_FRAME_BYTES + 64);
        send(
            &mut ws,
            json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "pad": oversized}),
        )
        .await;

        // The connection must go away rather than answer. Bounded so a regression that keeps it
        // open fails here instead of hanging.
        let closed = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                match ws.next().await {
                    None => return true,
                    Some(Err(_)) => return true,
                    Some(Ok(_)) => return false,
                }
            }
        })
        .await;
        assert_eq!(
            closed,
            Ok(true),
            "a frame over the transport ceiling must close the connection, not answer it"
        );
    }

    /// The per-kind ceiling: a METHOD-bearing frame over `MAX_NON_TUNNEL_FRAME_BYTES` is refused
    /// with an error and the connection SURVIVES.
    ///
    /// This is the half the smoke script never covered. The 8 MiB allowance exists for tunnel
    /// results, which arrive as client responses; letting a method-bearing frame use it would make
    /// the allowance a way to park `MAX_INFLIGHT_PROMPTS` × 8 MiB of prompt text per connection.
    #[tokio::test]
    async fn a_method_frame_over_its_ceiling_is_refused_but_keeps_the_connection() {
        let (url, _registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        // Over 1 MiB, comfortably under 8 MiB — so it reaches the per-kind check, not the
        // transport one. Asserting the gap between the two ceilings is the point.
        let pad = "y".repeat(super::MAX_NON_TUNNEL_FRAME_BYTES + 4096);
        assert!(
            pad.len() < super::MAX_FRAME_BYTES,
            "must not trip the transport ceiling"
        );
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 7, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}, "pad": pad}
            }),
        )
        .await;

        let resp = recv(&mut ws).await;
        assert_eq!(resp["id"], json!(7));
        assert!(
            resp.get("error").is_some(),
            "an oversized request must be answered with an error: {resp}"
        );

        // And the connection still works — the discriminating half. A regression that closed here
        // would satisfy every assertion above.
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 8, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let after = recv(&mut ws).await;
        assert_eq!(after["id"], json!(8));
        assert!(
            after.get("result").is_some(),
            "the connection must survive a per-kind refusal: {after}"
        );
    }

    /// The eviction branch's ONLY coverage — and the scenario that proves it is not dead code.
    ///
    /// `a_resume_replacing_a_same_name_tunnel_disconnects_the_one_it_replaced` is named for
    /// last-attach-wins but never reaches it: on the resume path the sweep runs before
    /// `spawn_acp_tunnels`, so the same-name predecessor is already retired and `replaced` is
    /// empty. That left `if !replaced.is_empty()` with no test at all.
    ///
    /// It IS reachable through a single `session/new`. `accept_acp_servers` dedups on `id` alone
    /// (`seen.insert(s.id.clone())`), so one declaration may legally carry two servers sharing a
    /// NAME with different ids, and `session/new` runs no sweep — the channel is a freshly minted
    /// uuid that cannot collide. The two establishes race; whichever takes the registry lock
    /// second sees its same-name predecessor, `same_name` matches, and the eviction disconnect
    /// fires. Two same-name declarations are a client error, but the gateway accepts them, so the
    /// path has to exist and has to behave.
    ///
    /// Which of the two wins is a genuine race, so this asserts the RELATION rather than a
    /// winner: exactly one tunnel survives, and the disconnect names the one that did not. That
    /// holds under either interleaving, so the test itself is stable.
    ///
    /// WHAT IT DOES NOT GUARANTEE — read before relying on this as eviction coverage.
    ///
    /// `generation` is stamped inside `establish_and_register_tunnel`, i.e. within the spawned
    /// task, so declaration order does NOT determine generation order. Both establishes share a
    /// `connection_generation`, so ordering falls to `generation`, and which arm runs depends on
    /// the scheduler:
    ///
    ///   - lower-generation task registers first → the later one evicts it → EVICTION arm;
    ///   - higher-generation task registers first → the earlier one is superseded and stands down,
    ///     closing its own connection → SUPERSEDED arm, and eviction never runs.
    ///
    /// Both produce "one survivor, loser gets the disconnect", which is why the assertions cannot
    /// tell them apart. Measured on this machine: 20 of 20 runs took the EVICTION arm, so the
    /// coverage is real in practice — but it is not guaranteed by construction, and a change that
    /// broke eviction could pass on an unlucky-for-us schedule.
    ///
    /// The fix is to stamp `generation` in the declaration loop of `spawn_acp_tunnels` rather than
    /// inside the task. Declaration order within one request is the only order the client ever
    /// expressed, so that is arguably more faithful than task-scheduling order, and it would make
    /// this test cover the eviction arm deterministically. Filed as a follow-up rather than done
    /// here: it changes the ordering semantics the whole last-attach-wins design rests on, and
    /// that deserves its own review rather than riding along with a test.
    #[tokio::test]
    async fn two_same_name_servers_in_one_session_evict_down_to_one() {
        let (url, registry) = serve().await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let init = recv(&mut ws).await;
        assert!(init.get("result").is_some(), "initialize failed: {init}");

        // Same name, different ids — accepted, because the dedup key is the id.
        send(
            &mut ws,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/new",
                "params": {
                    "cwd": "/w",
                    "mcpServers": [
                        {"type": "acp", "id": "uuid-a", "name": "katashiro"},
                        {"type": "acp", "id": "uuid-b", "name": "katashiro"}
                    ]
                }
            }),
        )
        .await;

        // Answer both connects, absorb both inner lifecycles, and wait for the disconnect the
        // loser is owed. Bounded so a regression fails naming what was missing rather than
        // sitting in `recv` until its 30s guard trips — a failure named after the harness reads
        // as a flake.
        let mut connected = std::collections::HashMap::new();
        let mut disconnected: Option<String> = None;
        let mut session_seen = false;
        for _ in 0..40 {
            if disconnected.is_some() && session_seen && connected.len() == 2 {
                break;
            }
            // The 40 bounds the frame COUNT; this bounds the WAIT, and only together do they do
            // what the comment claims. `recv` blocks, so a regression that never sends the
            // disconnect would not run out the loop and fail with the state below — it would sit
            // on frame 9 until `recv`'s own 30s guard fired, reporting a harness timeout instead
            // of the missing disconnect. Breaking out here keeps the failure attributable.
            let Ok(frame) =
                tokio::time::timeout(std::time::Duration::from_secs(2), recv(&mut ws)).await
            else {
                break;
            };
            if handled_inner_lifecycle(&mut ws, &frame).await.is_some() {
                continue;
            }
            match frame.get("method").and_then(Value::as_str) {
                Some("mcp/connect") => {
                    let acp_id = frame["params"]["acpId"]
                        .as_str()
                        .expect("acpId")
                        .to_string();
                    let conn = format!("conn-{}", acp_id.trim_start_matches("uuid-"));
                    connected.insert(acp_id, conn.clone());
                    send(
                        &mut ws,
                        json!({
                            "jsonrpc": "2.0", "id": frame["id"].clone(),
                            "result": {"connectionId": conn}
                        }),
                    )
                    .await;
                }
                Some("mcp/disconnect") => {
                    disconnected = Some(
                        frame["params"]["connectionId"]
                            .as_str()
                            .expect("connectionId")
                            .to_string(),
                    );
                }
                _ => {
                    if frame.get("id") == Some(&json!(2)) {
                        assert!(
                            frame.get("result").is_some(),
                            "session/new refused: {frame}"
                        );
                        session_seen = true;
                    }
                }
            }
        }
        assert_eq!(
            connected.len(),
            2,
            "both declared servers must be asked to connect"
        );
        let evicted = disconnected.expect(
            "the evicted tunnel is owed an mcp/disconnect — if this is missing, the eviction \
             branch did not run and this scenario no longer covers it",
        );

        wait_for_tunnels(&registry, 1).await;
        let survivors: Vec<String> = {
            let reg = registry.lock().unwrap();
            reg.values().map(|h| h.connection_id.clone()).collect()
        };
        assert_eq!(
            survivors.len(),
            1,
            "last-attach-wins must collapse the name to one tunnel"
        );
        assert_ne!(
            survivors[0], evicted,
            "the disconnect must name the tunnel that LOST, not the one still registered"
        );
        assert!(
            connected.values().any(|c| c == &evicted),
            "the disconnected connection must be one of the two we opened, got {evicted}"
        );
    }

    /// A reconnect that **resumes** the same session re-declares the same NAME with a fresh id.
    /// That evicts the stale tunnel, and the client is owed an `mcp/disconnect` for the connection
    /// it still believes is open (review R7).
    ///
    /// It has to be a resume, not a second `session/new`: eviction is scoped to one `channel_id`
    /// (`c == &channel_id` in `establish_and_register_tunnel`), and a new session is a new channel,
    /// so two independent sessions declaring the same name do not collide and must not evict each
    /// other. Writing this as two `session/new` calls asserts nothing.
    #[tokio::test]
    async fn a_resume_replacing_a_same_name_tunnel_disconnects_the_one_it_replaced() {
        let (url, registry) = serve().await;
        let (mut first, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        let session_id = handshake(&mut first, "uuid-old", "katashiro", "conn-old").await;
        wait_for_tunnels(&registry, 1).await;

        // The client comes back on a fresh socket and resumes, re-declaring under the same name
        // with the fresh id its runtime mints per connection.
        let (mut second, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        send(
            &mut second,
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": 1, "clientCapabilities": {}}
            }),
        )
        .await;
        let _ = recv(&mut second).await;
        send(
            &mut second,
            json!({
                "jsonrpc": "2.0", "id": 2, "method": "session/resume",
                "params": {
                    "sessionId": session_id,
                    "cwd": "/w",
                    "mcpServers": [{"type": "acp", "id": "uuid-new", "name": "katashiro"}]
                }
            }),
        )
        .await;
        let mut connected_new = false;
        let mut new_lifecycle = 0;
        while !connected_new || new_lifecycle < 2 {
            let frame = recv(&mut second).await;
            if handled_inner_lifecycle(&mut second, &frame).await.is_some() {
                new_lifecycle += 1;
                continue;
            }
            if frame.get("method").and_then(Value::as_str) == Some("mcp/connect") {
                send(
                    &mut second,
                    json!({
                        "jsonrpc": "2.0", "id": frame["id"].clone(),
                        "result": {"connectionId": "conn-new"}
                    }),
                )
                .await;
                connected_new = true;
            }
            if frame.get("id") == Some(&json!(2)) {
                assert!(
                    frame.get("result").is_some(),
                    "session/resume was refused, so no tunnel is opened: {frame}"
                );
            }
        }

        // WHAT THIS TEST ACTUALLY COVERS — measured, not assumed.
        //
        // The name says last-attach-wins eviction (R7). It does not exercise it. Instrumenting
        // every `mcp/disconnect` emitter and running this test against unmodified code shows one
        // line: the WITHDRAWAL-RETIREMENT path (`resume withdrew declarations`). The eviction
        // branch never runs, because the resume drops `uuid-old` from the accepted set, so
        // retirement removes that registry entry BEFORE the establish for `uuid-new` looks for
        // same-name predecessors — `replaced` is empty and `if !replaced.is_empty()` is false.
        //
        // A mutation confirms it: redirecting the eviction disconnect from the stale handles to
        // the newly registered one (preserving "empty unless something was replaced") leaves this
        // test GREEN. So the assertions below cannot distinguish disconnecting the right tunnel
        // from disconnecting the wrong one — they are satisfied by a different mechanism.
        //
        // The previous comment here claimed the opposite ("an implementation that disconnected the
        // newly registered tunnel would pass too"), and the commit that added it reported the
        // assertion as mutation-checked by flipping the expected `connectionId`. That mutates the
        // TEST, not the code; negating a tautology also goes red. Both claims were wrong.
        //
        // Whether `same_name` eviction is reachable through a resume AT ALL is an open question
        // filed for review, not something this test should paper over.
        let framed = recv(&mut first).await;
        assert_eq!(framed["method"], json!("mcp/disconnect"));
        assert_eq!(
            framed["params"]["connectionId"],
            json!("conn-old"),
            "the evicted connection is the one owed a disconnect, not its replacement"
        );

        // And the survivor is the new one.
        let names: Vec<String> = {
            let reg = registry.lock().unwrap();
            reg.values().map(|h| h.connection_id.clone()).collect()
        };
        assert_eq!(
            names,
            vec!["conn-new".to_string()],
            "only the newest tunnel may remain"
        );

        // The survivor must WORK, not merely be present in the registry: a replacement that
        // registers a handle whose socket is gone satisfies every assertion above. This is the
        // `mcp/message` round trip the review request for this trio announced and this test never
        // performed.
        //
        // It also pins frame ORDER on the surviving socket. Frames on one socket are ordered, so
        // any implementation that wrote a disconnect to the replacement would have to write it
        // before this response — asserting the next frame is the tool call fails fast and names
        // the reason, where a missing-frame check could only time out.
        let handle = {
            let reg = registry.lock().unwrap();
            reg.values()
                .next()
                .expect("the survivor must be registered")
                .clone()
        };
        let call = tokio::spawn(async move {
            handle
                .mcp_message("tools/call", Some(json!({"name": "katashiro.click"})), 5)
                .await
        });

        let request = recv(&mut second).await;
        assert_eq!(
            request["method"],
            json!("mcp/message"),
            "the next frame owed to the surviving connection is the tool call, not a disconnect"
        );
        assert_eq!(request["params"]["connectionId"], json!("conn-new"));
        send(
            &mut second,
            json!({
                "jsonrpc": "2.0", "id": request["id"].clone(),
                "result": {"content": [{"type": "text", "text": "clicked"}]}
            }),
        )
        .await;
        let got = call
            .await
            .unwrap()
            .expect("the surviving tunnel must carry a call");
        assert_eq!(got["content"][0]["text"], json!("clicked"));
    }

    async fn serve_with_credentials(store: Arc<CredentialStore>) -> String {
        serve_with_credentials_and(store, |_| {}).await
    }

    async fn serve_with_credentials_and(
        store: Arc<CredentialStore>,
        configure: impl FnOnce(&mut crate::AppState),
    ) -> String {
        let (tx, _rx) = tokio::sync::broadcast::channel(16);
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
        configure(&mut state);
        let app = axum::Router::new()
            .route("/acp", axum::routing::get(ws_upgrade))
            .with_state(Arc::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("ws://{addr}/acp")
    }

    async fn call(ws: &mut Ws, id: u64, method: &str, params: Value) -> Value {
        send(
            ws,
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
        )
        .await;
        loop {
            let frame = recv(ws).await;
            if frame["id"] == id {
                return frame;
            }
        }
    }

    fn listed_sessions(state: &Value) -> Vec<String> {
        let mut ids: Vec<String> = state["result"]["sessions"]
            .as_array()
            .expect("runtime state lists sessions")
            .iter()
            .map(|s| s["sessionId"].as_str().unwrap().to_string())
            .collect();
        ids.sort();
        ids
    }

    #[tokio::test]
    async fn bindings_cannot_see_or_act_on_each_others_sessions() {
        let deployment_control = "c".repeat(40);
        let store = Arc::new(CredentialStore::in_memory(
            None,
            Some(deployment_control.clone()),
        ));
        let a = store
            .create_pending("a".into(), Default::default())
            .unwrap();
        let b = store
            .create_pending("b".into(), Default::default())
            .unwrap();
        let sess_a = format!("sess_{}", Uuid::new_v4());
        let sess_b = format!("sess_{}", Uuid::new_v4());
        let channels = vec![
            derive_channel_id(&sess_a).unwrap(),
            derive_channel_id(&sess_b).unwrap(),
        ];
        let url = serve_with_credentials_and(store.clone(), move |state| {
            state.acp_session_snapshot = Some(Arc::new(|_| {
                Box::pin(async { json!({"epoch":"p","state":"active","operation":"prompt"}) })
            }));
            state.acp_session_inventory = Some(Arc::new(move || {
                let channels = channels.clone();
                Box::pin(async move { channels })
            }));
        })
        .await;

        let mut a_transport = connect_bearer(&url, &a.transport_key).await.unwrap();
        let mut a_control = connect_bearer(&url, &a.control_key).await.unwrap();
        let mut b_transport = connect_bearer(&url, &b.transport_key).await.unwrap();
        let mut b_control = connect_bearer(&url, &b.control_key).await.unwrap();
        let mut operator = connect_bearer(&url, &deployment_control).await.unwrap();
        for ws in [
            &mut a_transport,
            &mut a_control,
            &mut b_transport,
            &mut b_control,
            &mut operator,
        ] {
            initialize(ws).await;
        }
        let resume = |session: &str| json!({"sessionId": session, "cwd": "/tmp"});

        assert!(
            call(&mut a_transport, 2, "session/resume", resume(&sess_a)).await["result"]
                .is_object()
        );
        assert!(
            call(&mut b_transport, 2, "session/resume", resume(&sess_b)).await["result"]
                .is_object()
        );
        assert_eq!(
            call(&mut b_transport, 3, "session/resume", resume(&sess_a)).await["error"]["code"],
            -32003,
            "a binding cannot take over another binding's session"
        );

        let a_state = call(&mut a_control, 2, "_openab/runtime/state", json!({})).await;
        assert_eq!(listed_sessions(&a_state), vec![sess_a.clone()]);
        let b_state = call(&mut b_control, 2, "_openab/runtime/state", json!({})).await;
        assert_eq!(listed_sessions(&b_state), vec![sess_b.clone()]);
        let everything = call(&mut operator, 2, "_openab/runtime/state", json!({})).await;
        let mut both = vec![sess_a.clone(), sess_b.clone()];
        both.sort();
        assert_eq!(listed_sessions(&everything), both);

        let text = json!([{"type":"text","text":"hi"}]);
        let foreign = [
            (
                "_openab/session/steer",
                json!({"sessionId": sess_a, "messageId": Uuid::new_v4().to_string(), "prompt": text}),
            ),
            (
                "_openab/session/requests",
                json!({"sessionId": sess_a, "operation": "resolve", "requestId": "r"}),
            ),
            ("_openab/session/state", json!({"sessionId": sess_a})),
            (
                "_openab/session/config_options",
                json!({"sessionId": sess_a}),
            ),
            ("session/cancel", json!({"sessionId": sess_a})),
        ];
        for (n, (method, params)) in foreign.into_iter().enumerate() {
            let response = call(&mut b_control, 10 + n as u64, method, params.clone()).await;
            assert_eq!(
                response["error"]["message"], FOREIGN_SESSION,
                "{method}: {response}"
            );
            let response = call(&mut b_transport, 10 + n as u64, method, params).await;
            assert_eq!(response["error"]["code"], -32003, "{method}: {response}");
        }
        assert_eq!(
            call(
                &mut a_control,
                3,
                "_openab/session/state",
                json!({"sessionId": sess_a})
            )
            .await["result"]["state"],
            "active",
            "a binding still reaches its own session"
        );

        assert!(store.revoke(&a.id).unwrap());
        assert!(
            call(&mut b_transport, 20, "session/resume", resume(&sess_a)).await["result"]
                .is_object(),
            "a revoked binding's sessions are released"
        );
    }

    #[tokio::test]
    async fn a_resume_refused_by_the_session_cap_claims_nothing() {
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let a = store
            .create_pending("a".into(), Default::default())
            .unwrap();
        let url = serve_with_credentials(store.clone()).await;
        let mut ws = connect_bearer(&url, &a.transport_key).await.unwrap();
        initialize(&mut ws).await;
        for n in 0..MAX_SESSIONS_PER_CONNECTION {
            let session = format!("sess_{}", Uuid::new_v4());
            let resumed = call(
                &mut ws,
                100 + n as u64,
                "session/resume",
                json!({"sessionId": session, "cwd": "/tmp"}),
            )
            .await;
            assert!(resumed["result"].is_object(), "{resumed}");
        }
        let refused = format!("sess_{}", Uuid::new_v4());
        let response = call(
            &mut ws,
            1,
            "session/resume",
            json!({"sessionId": refused, "cwd": "/tmp"}),
        )
        .await;
        assert_eq!(response["error"]["code"], ACP_OVERLOADED);
        assert_eq!(
            store.sessions.owner(&derive_channel_id(&refused).unwrap()),
            None
        );
    }

    #[tokio::test]
    async fn a_binding_with_every_session_attached_is_refused_a_new_one() {
        let mut store = CredentialStore::in_memory(None, None);
        store.sessions = super::super::session_owners::SessionOwners::default()
            .with_limits(1, std::time::Duration::ZERO);
        let store = Arc::new(store);
        let a = store
            .create_pending("a".into(), Default::default())
            .unwrap();
        let url = serve_with_credentials_and(store.clone(), |state| {
            state.acp_reply_registry = Some(new_reply_registry());
        })
        .await;
        let mut ws = connect_bearer(&url, &a.transport_key).await.unwrap();
        initialize(&mut ws).await;
        let new_session = json!({"cwd": "/tmp", "mcpServers": []});

        let first = call(&mut ws, 2, "session/new", new_session.clone()).await;
        assert!(first["result"]["sessionId"].is_string(), "{first}");
        let second = call(&mut ws, 3, "session/new", new_session).await;
        assert_eq!(second["error"]["code"], ACP_OVERLOADED, "{second}");
        assert_eq!(second["error"]["message"], BINDING_SESSIONS_IN_USE);
        assert_eq!(store.sessions.claimed_count(), 1);
    }

    #[tokio::test]
    async fn a_session_whose_ownership_cannot_be_written_is_refused() {
        let dir = std::env::temp_dir().join(format!("openab-acp-owners-{}", Uuid::new_v4()));
        let store = Arc::new(CredentialStore::open(dir.clone(), None, None, None).unwrap());
        let a = store
            .create_pending("a".into(), Default::default())
            .unwrap();
        let url = serve_with_credentials(store.clone()).await;
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::write(&dir, b"not a directory").unwrap();

        let mut ws = connect_bearer(&url, &a.transport_key).await.unwrap();
        initialize(&mut ws).await;
        let created = call(
            &mut ws,
            2,
            "session/new",
            json!({"cwd": "/tmp", "mcpServers": []}),
        )
        .await;
        assert_eq!(created["error"]["code"], -32603, "{created}");
        assert_eq!(created["error"]["message"], OWNERSHIP_UNRECORDED);
        let resumed = call(
            &mut ws,
            3,
            "session/resume",
            json!({"sessionId": format!("sess_{}", Uuid::new_v4()), "cwd": "/tmp"}),
        )
        .await;
        assert_eq!(resumed["error"]["message"], OWNERSHIP_UNRECORDED);
        assert_eq!(store.sessions.claimed_count(), 0);
        let _ = std::fs::remove_file(dir);
    }

    #[test]
    fn the_legacy_binding_is_single_tenant() {
        let principal = Principal {
            binding_id: Some("legacy".into()),
            role: Role::Control,
        };
        assert_eq!(principal.session_scope(), None);
        let paired = Principal {
            binding_id: Some("abc".into()),
            role: Role::Transport,
        };
        assert_eq!(paired.session_scope(), Some("abc"));
    }

    async fn connect_bearer(url: &str, token: &str) -> Result<Ws, u16> {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request = url.into_client_request().unwrap();
        request
            .headers_mut()
            .insert("Authorization", format!("Bearer {token}").parse().unwrap());
        match tokio_tungstenite::connect_async(request).await {
            Ok((ws, _)) => Ok(ws),
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
                Err(response.status().as_u16())
            }
            Err(e) => panic!("unexpected handshake error: {e}"),
        }
    }

    async fn initialize(ws: &mut Ws) {
        send(
            ws,
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
        )
        .await;
        assert!(recv(ws).await["result"].is_object());
    }

    #[tokio::test]
    async fn a_credential_store_without_bindings_rejects_every_upgrade() {
        let url = serve_with_credentials(Arc::new(CredentialStore::in_memory(None, None))).await;
        assert_eq!(connect_bearer(&url, "anything").await.err(), Some(401));
        match tokio_tungstenite::connect_async(url.as_str()).await {
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
                assert_eq!(response.status().as_u16(), 401)
            }
            _ => panic!("a keyless upgrade must be refused when a credential store is configured"),
        }
    }

    #[tokio::test]
    async fn each_binding_holds_its_own_role_and_revoking_one_closes_only_its_sockets() {
        let store = Arc::new(CredentialStore::in_memory(None, None));
        let a = store
            .create_pending("a".into(), Default::default())
            .unwrap();
        let b = store
            .create_pending("b".into(), Default::default())
            .unwrap();
        let url = serve_with_credentials(store.clone()).await;

        let mut a_transport = connect_bearer(&url, &a.transport_key).await.unwrap();
        let mut a_control = connect_bearer(&url, &a.control_key).await.unwrap();
        let mut b_transport = connect_bearer(&url, &b.transport_key).await.unwrap();
        for ws in [&mut a_transport, &mut a_control, &mut b_transport] {
            initialize(ws).await;
        }

        send(
            &mut a_transport,
            json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/state"}),
        )
        .await;
        assert_eq!(recv(&mut a_transport).await["error"]["code"], -32003);
        send(
            &mut a_control,
            json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/state"}),
        )
        .await;
        let state = recv(&mut a_control).await;
        assert_ne!(
            state["error"]["code"], -32003,
            "a binding's control key is an operator: {state}"
        );

        assert!(store.revoke(&a.id).unwrap());
        for ws in [&mut a_transport, &mut a_control] {
            let close = loop {
                match tokio::time::timeout(std::time::Duration::from_secs(10), ws.next())
                    .await
                    .expect("a revoked binding's socket must close")
                {
                    Some(Ok(WsMessage::Close(frame))) => break frame,
                    Some(Ok(_)) => continue,
                    other => panic!("expected a close frame, got {other:?}"),
                }
            };
            let frame = close.expect("the close carries a reason");
            assert_eq!(u16::from(frame.code), BINDING_REVOKED_CLOSE_CODE);
        }
        assert_eq!(
            connect_bearer(&url, &a.transport_key).await.err(),
            Some(401)
        );

        send(
            &mut b_transport,
            json!({"jsonrpc":"2.0","id":3,"method":"_openab/runtime/state"}),
        )
        .await;
        assert_eq!(
            recv(&mut b_transport).await["id"],
            3,
            "the other binding keeps its socket"
        );
        assert!(connect_bearer(&url, &b.transport_key).await.is_ok());
    }

    #[tokio::test]
    async fn deployment_keys_still_work_beside_the_store() {
        let transport = "t".repeat(40);
        let control = "c".repeat(40);
        let store = Arc::new(CredentialStore::in_memory(
            Some(transport.clone()),
            Some(control.clone()),
        ));
        let url = serve_with_credentials(store).await;
        let mut ws = connect_bearer(&url, &transport).await.unwrap();
        initialize(&mut ws).await;
        send(
            &mut ws,
            json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/state"}),
        )
        .await;
        assert_eq!(recv(&mut ws).await["error"]["code"], -32003);
        let mut operator = connect_bearer(&url, &control).await.unwrap();
        initialize(&mut operator).await;
        send(
            &mut operator,
            json!({"jsonrpc":"2.0","id":2,"method":"_openab/runtime/state"}),
        )
        .await;
        assert_ne!(recv(&mut operator).await["error"]["code"], -32003);
    }
}

/// Teardown ownership (canonical item 2).
///
/// Both registries are keyed by things that outlive a connection — the reply registry by
/// `channel_id`, the tunnel registry by `(channel_id, server_id)` — and `session/resume` hands the
/// same channel to a *new* connection. So "remove the keys for my sessions" deletes a successor's
/// live entry. "Only remove keys I inserted" is no better: the key is reused, so it cannot tell the
/// two apart. The owner can.
///
/// All three cases below fail against key-only teardown.
/// Operator logs must not hand out a resume credential.
#[cfg(test)]
mod acp_log_redaction {
    use super::*;

    /// The two ids are the same uuid under different prefixes, so either one in a log line is a
    /// working `session/resume` credential. This is the property that makes redaction necessary —
    /// if it ever stops holding, the redaction is solving a problem that moved.
    #[test]
    fn a_channel_id_yields_its_session_id() {
        let uuid = Uuid::new_v4();
        let session_id = format!("sess_{uuid}");
        let channel_id = derive_channel_id(&session_id).unwrap();
        assert_eq!(channel_id, format!("acp_{uuid}"));
        assert_eq!(
            channel_id.strip_prefix("acp_"),
            session_id.strip_prefix("sess_"),
            "one is trivially derivable from the other — that is why neither may be logged raw"
        );
    }

    #[test]
    fn a_redacted_id_is_stable_but_does_not_contain_the_original() {
        let uuid = Uuid::new_v4();
        let channel_id = format!("acp_{uuid}");
        let tag = redact_id(&channel_id);

        assert_eq!(
            tag,
            redact_id(&channel_id),
            "same id must tag identically, or logs stop \
                                                 being correlatable across lines"
        );
        assert!(
            !tag.contains(&uuid.to_string()),
            "the uuid must not survive into the tag"
        );
        assert!(
            !tag.contains(&channel_id) && !channel_id.contains(&tag[1..]),
            "the tag must not be a substring of the id or vice versa"
        );
        assert_ne!(
            tag,
            redact_id(&format!("acp_{}", Uuid::new_v4())),
            "different ids differ"
        );
    }

    /// No `info!`/`warn!`/`error!` in this file may carry a raw channel or session id.
    ///
    /// Written as a source scan because the defect is a *class*, not a line: the item named two
    /// sites, and a multi-line-aware sweep found four — the two extra ones added by later items in
    /// this same round, and missed by a line-oriented grep because the macro and the field sat on
    /// different lines. Pinning the four known sites would pass while the next wrapped `info!`
    /// reintroduced the leak.
    #[test]
    fn no_operator_log_line_carries_a_raw_acp_id() {
        let src = include_str!("acp_server.rs");
        let mut offenders: Vec<String> = Vec::new();
        for macro_open in ["info!(", "warn!(", "error!("] {
            let mut from = 0;
            while let Some(rel) = src[from..].find(macro_open) {
                let start = from + rel;
                // Balance from the macro's own opening paren, so a mention of `info!` in prose
                // cannot send this scanning for a close paren that was never opened.
                let open = start + macro_open.len() - 1;
                from = open + 1;
                let mut depth = 0usize;
                let mut end = open;
                for (i, c) in src[open..].char_indices() {
                    match c {
                        '(' => depth += 1,
                        ')' => {
                            depth -= 1;
                            if depth == 0 {
                                end = open + i;
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                let body = &src[start..=end];
                // `%channel_id` / `%session_id` interpolate the raw value; `redact_id(..)` does not.
                if body.contains("%channel_id") || body.contains("%session_id") {
                    let line = src[..start].matches('\n').count() + 1;
                    offenders.push(format!(
                        "{line}: {}",
                        body.split_whitespace()
                            .take(8)
                            .collect::<Vec<_>>()
                            .join(" ")
                    ));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these operator-visible log lines carry a raw resume credential: {offenders:#?}"
        );
    }
}

#[cfg(test)]
mod acp_teardown_ownership {
    use super::*;

    fn tunnel(owner: &str, connection_id: &str) -> TunnelHandle {
        let (out_tx, _rx) = mpsc::unbounded_channel::<String>();
        TunnelHandle {
            out_tx,
            pending: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
            connection_id: connection_id.into(),
            server_name: "katashiro".into(),
            owner: owner.into(),
            generation: 0,
            connection_generation: 0,
        }
    }

    /// Model the teardown predicate exactly as `cleanup` applies it, so the test exercises the
    /// rule rather than a paraphrase of it.
    fn teardown(reg: &AcpTunnelRegistry, channel_ids: &[&str], closing: &str) {
        let mut reg = reg.lock().unwrap();
        reg.retain(|(cid, _), h| !(channel_ids.contains(&cid.as_str()) && h.owner == closing));
    }

    /// A connection that closes must not take its successor's tunnel with it.
    ///
    /// The old connection's cleanup runs late — after the client reconnected, resumed the same
    /// channel and registered a fresh tunnel. Under key-only teardown the successor's handle is
    /// removed and a working session loses its browser with no error anywhere.
    #[test]
    fn a_late_cleanup_does_not_remove_the_successors_tunnel() {
        let reg = new_tunnel_registry();
        {
            let mut r = reg.lock().unwrap();
            // The successor: same channel, fresh server id, different connection.
            r.insert(
                ("acp_x".into(), "srv-new".into()),
                tunnel("conn-B", "cid-new"),
            );
        }
        teardown(&reg, &["acp_x"], "conn-A");

        let r = reg.lock().unwrap();
        assert!(
            r.contains_key(&("acp_x".to_string(), "srv-new".to_string())),
            "conn-A's cleanup must not remove a tunnel owned by conn-B on the same channel"
        );
    }

    /// Its own entries still go.
    #[test]
    fn a_cleanup_still_removes_the_tunnels_it_owns() {
        let reg = new_tunnel_registry();
        {
            let mut r = reg.lock().unwrap();
            r.insert(("acp_x".into(), "srv-a".into()), tunnel("conn-A", "cid-a"));
            r.insert(("acp_x".into(), "srv-b".into()), tunnel("conn-B", "cid-b"));
        }
        teardown(&reg, &["acp_x"], "conn-A");

        let r = reg.lock().unwrap();
        assert!(
            !r.contains_key(&("acp_x".to_string(), "srv-a".to_string())),
            "conn-A's own tunnel must go"
        );
        assert!(
            r.contains_key(&("acp_x".to_string(), "srv-b".to_string())),
            "conn-B's must stay"
        );
        assert_eq!(r.len(), 1);
    }

    /// A reply sink installed by a successor survives the predecessor's cleanup.
    ///
    /// Same defect, quieter symptom: the sink is how a prompt's output reaches the client, so
    /// deleting the wrong one produces a session that accepts prompts and answers none.
    #[test]
    fn a_late_cleanup_does_not_remove_the_successors_reply_sink() {
        let reg = new_reply_registry();
        {
            let (tx, _rx) = mpsc::unbounded_channel::<ReplyChunk>();
            reg.lock().unwrap().insert(
                "acp_x".into(),
                ReplySink {
                    turn_id: Some("evt_new".into()),
                    tx: Some(tx),
                    session_id: "sess_x".into(),
                    out_tx: mpsc::unbounded_channel().0,
                    owner: "conn-B".into(),
                    generation: 0,
                    permission_relay: None,
                },
            );
        }
        {
            let mut r = reg.lock().unwrap();
            let channel_ids = ["acp_x"];
            r.retain(|cid, s| !(channel_ids.contains(&cid.as_str()) && s.owner == "conn-A"));
        }
        let r = reg.lock().unwrap();
        assert_eq!(
            r.get("acp_x").and_then(|s| s.turn_id.as_deref()),
            Some("evt_new"),
            "conn-A's cleanup must leave conn-B's sink in place, or the live session goes mute"
        );
    }
}

#[cfg(test)]
mod session_config_tests {
    use super::*;

    #[tokio::test]
    async fn config_control_validates_and_does_not_attach_output() {
        let (events, _) = tokio::sync::broadcast::channel(1);
        let mut state = crate::AppState::test_default(events);
        let sid = format!("sess_{}", Uuid::new_v4());
        let params = json!({"sessionId": sid, "configId": "model", "value": "gpt-test"});
        let missing = handle_session_config(&state, json!(1), Some(&params), false, false).await;
        assert_eq!(missing.error.unwrap().code, -32601);
        let (tx, mut rx) = mpsc::channel::<crate::AcpPoolConfigRequest>(2);
        state.acp_pool_config = Some(tx);
        let bad = handle_session_config(
            &state,
            json!(1),
            Some(&json!({"sessionId":"bad"})),
            false,
            false,
        )
        .await;
        assert_eq!(bad.error.unwrap().code, -32602);
        let bad_value = handle_session_config(
            &state,
            json!(1),
            Some(&json!({"sessionId":sid,"configId":"model","value":true})),
            true,
            false,
        )
        .await;
        assert_eq!(bad_value.error.unwrap().code, -32602);
        assert!(rx.try_recv().is_err());
        let channel = derive_channel_id(&sid).unwrap();
        let expected_channel = format!("acp:{channel}");
        let operations = state.acp_session_operations.clone();
        let worker = tokio::spawn(async move {
            let read = rx.recv().await.unwrap();
            assert_eq!(read.thread_key, expected_channel);
            assert!(read.selection.is_none());
            assert!(
                !operations.pending(&channel),
                "read must not create execution state"
            );
            read.reply
                .send(Ok(
                    json!({"configOptions": [{"id":"model","currentValue":"before"}]}),
                ))
                .unwrap();
            let write = rx.recv().await.unwrap();
            assert_eq!(write.selection, Some(("model".into(), "gpt-test".into())));
            assert!(operations.pending(&channel), "write remains runtime work");
            write.reply.send(Err((-32005, "busy".into()))).unwrap();
        });
        let read = handle_session_config(&state, json!(2), Some(&params), false, false).await;
        assert_eq!(
            read.result.unwrap()["configOptions"][0]["currentValue"],
            "before"
        );
        let write = handle_session_config(&state, json!(3), Some(&params), true, false).await;
        assert_eq!(write.error.unwrap().code, -32005);
        worker.await.unwrap();
        let (tx, mut rx) = mpsc::channel::<crate::AcpPoolConfigRequest>(2);
        state.acp_pool_config = Some(tx);
        let restore = json!({"sessionId": sid, "restore": {"cwd":"/saved", "_meta":{"owner":"fresh"}, "mcpServers": []}});
        assert_eq!(
            handle_session_config(&state, json!(4), Some(&restore), false, false)
                .await
                .error
                .unwrap()
                .code,
            -32601
        );
        for value in [None, Some(Value::Null), Some(json!({}))] {
            let mut incomplete = restore.clone();
            incomplete["restore"]
                .as_object_mut()
                .unwrap()
                .remove("mcpServers");
            if let Some(value) = value {
                incomplete["restore"]["mcpServers"] = value;
            }
            let rejected =
                handle_session_config(&state, json!(6), Some(&incomplete), false, true).await;
            assert_eq!(rejected.error.unwrap().code, -32602);
            assert!(
                rx.try_recv().is_err(),
                "incomplete restore cannot mutate saved tools"
            );
        }
        let operations = state.acp_session_operations.clone();
        let channel = derive_channel_id(&sid).unwrap();
        let worker = tokio::spawn(async move {
            let request = rx.recv().await.unwrap();
            assert!(
                operations.pending(&channel),
                "explicit restore remains runtime work"
            );
            // The client's cwd is not forwarded: a restore runs where the session's prompts run.
            assert_eq!(
                request.restore,
                Some((vec![], Some(json!({"owner":"fresh"}))))
            );
            request
                .reply
                .send(Ok(json!({"configOptions": []})))
                .unwrap();
        });
        assert!(
            handle_session_config(&state, json!(5), Some(&restore), false, true)
                .await
                .error
                .is_none()
        );
        worker.await.unwrap();
    }
}

#[cfg(test)]
mod runtime_authority_tests {
    use super::*;
    #[tokio::test]
    async fn cancel_during_creation_is_delivered_before_a_successor_can_start() {
        let (events, mut observed_events) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(events);
        let provider = Arc::new(std::sync::Mutex::new(
            json!({"state":"unknown","operation":"loading"}),
        ));
        let read_provider = provider.clone();
        state.acp_session_snapshot = Some(Arc::new(move |_| {
            let provider = read_provider.clone();
            Box::pin(async move { provider.lock().unwrap().clone() })
        }));
        let channel = "acp_173201f5-7973-4186-ae78-e63c2988d1b9";
        let session = "sess_173201f5-7973-4186-ae78-e63c2988d1b9";
        let pending = Arc::new(std::sync::Mutex::new(Some(
            state.acp_session_operations.prompt(channel.into()),
        )));
        let deliveries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let delivered = deliveries.clone();
        let cancel_provider = provider.clone();
        state.acp_session_cancel = Some(Arc::new(move |_| {
            let pending = pending.clone();
            let provider = cancel_provider.clone();
            let delivered = delivered.clone();
            Box::pin(async move {
                if provider.lock().unwrap()["state"] != "active" {
                    return Err("still creating".into());
                }
                delivered.fetch_add(1, Ordering::SeqCst);
                *provider.lock().unwrap() = json!({"state":"idle","operation":"none"});
                pending.lock().unwrap().take();
                Ok(())
            })
        }));
        let state = Arc::new(state);
        let sessions = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let params = json!({"sessionId":session});
        handle_session_cancel(
            &state,
            &sessions,
            &state.event_tx,
            Value::Null,
            Some(&params),
            true,
        )
        .await;
        handle_session_cancel(
            &state,
            &sessions,
            &state.event_tx,
            Value::Null,
            Some(&params),
            true,
        )
        .await;
        assert_eq!(
            state.acp_session_operations.pending_count(channel),
            2,
            "duplicate cancels share one pending command"
        );
        let stopping = read_runtime_snapshot(&state, channel).await.unwrap();
        assert_eq!(stopping["phase"], "cancelling");
        assert_eq!(stopping["actions"]["send"], false);
        *provider.lock().unwrap() = json!({"state":"active","operation":"prompt"});
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while state.acp_session_operations.pending(channel) {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let stopped = read_runtime_snapshot(&state, channel).await.unwrap();
        assert_eq!(stopped["phase"], "cancelled");
        assert_eq!(stopped["actions"]["send"], true);
        assert_eq!(deliveries.load(Ordering::SeqCst), 1);
        state.acp_session_operations.accepted(channel);
        *provider.lock().unwrap() = json!({"state":"active","operation":"prompt"});
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        assert_eq!(
            deliveries.load(Ordering::SeqCst),
            1,
            "no old cancel reaches the successor"
        );
        assert!(
            observed_events.try_recv().is_err(),
            "control delivery is acknowledged, never queued twice"
        );
    }
}
