use crate::acp::protocol::{
    parse_config_options, parse_usage_report, ConfigOption, JsonRpcMessage, JsonRpcRequest,
    JsonRpcResponse, UsageReport,
};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, trace};

/// Bounds both prompt-scoped and idle ACP notification buffering. When full,
/// the reader applies backpressure to the agent stdout pipe instead of growing
/// process memory without limit.
pub const ACP_NOTIFICATION_CAPACITY: usize = 1024;

type NotificationSender = Arc<Mutex<Option<mpsc::Sender<JsonRpcMessage>>>>;

async fn current_notification_sender(
    notify_tx: &NotificationSender,
) -> Option<mpsc::Sender<JsonRpcMessage>> {
    notify_tx.lock().await.clone()
}

/// Pick the most permissive selectable permission option from ACP options.
fn pick_best_option(options: &[Value]) -> Option<String> {
    let mut fallback: Option<&Value> = None;

    for kind in ["allow_always", "allow_once"] {
        if let Some(option) = options
            .iter()
            .find(|option| option.get("kind").and_then(|k| k.as_str()) == Some(kind))
        {
            return option
                .get("optionId")
                .and_then(|id| id.as_str())
                .map(str::to_owned);
        }
    }

    for option in options {
        let kind = option.get("kind").and_then(|k| k.as_str());
        if kind == Some("reject_once") || kind == Some("reject_always") {
            continue;
        }
        fallback = Some(option);
        break;
    }

    fallback
        .and_then(|option| option.get("optionId"))
        .and_then(|id| id.as_str())
        .map(str::to_owned)
}

/// Build a spec-compliant permission response with backward-compatible fallback.
pub fn build_permission_response(params: Option<&Value>) -> Value {
    match params
        .and_then(|p| p.get("options"))
        .and_then(|options| options.as_array())
    {
        None => json!({
            "outcome": {
                "outcome": "selected",
                "optionId": "allow_always"
            }
        }),
        Some(options) => {
            if let Some(option_id) = pick_best_option(options) {
                json!({
                    "outcome": {
                        "outcome": "selected",
                        "optionId": option_id
                    }
                })
            } else {
                json!({
                    "outcome": {
                        "outcome": "cancelled"
                    }
                })
            }
        }
    }
}

fn expand_env(val: &str) -> String {
    if val.starts_with("${") && val.ends_with('}') {
        let key = &val[2..val.len() - 1];
        std::env::var(key).unwrap_or_default()
    } else {
        val.to_string()
    }
}
use tokio::time::Instant;

/// A content block for the ACP prompt — either text or image.
#[derive(Debug, Clone)]
pub enum ContentBlock {
    Text { text: String },
    Image { media_type: String, data: String },
}

impl ContentBlock {
    pub fn to_json(&self) -> Value {
        match self {
            ContentBlock::Text { text } => json!({
                "type": "text",
                "text": text
            }),
            ContentBlock::Image { media_type, data } => json!({
                "type": "image",
                "data": data,
                "mimeType": media_type
            }),
        }
    }
}

/// Lock-free view of session activity, readable without the connection mutex.
pub struct SessionActivity {
    pub execution: super::session_state::SessionState,
    connection_ended: AtomicBool,
    /// Milliseconds since process boot (monotonic) of the last observed activity.
    last_active_ms: AtomicU64,
    /// True while a prompt turn is in flight (mutex likely held).
    prompt_in_flight: AtomicBool,
    /// Milliseconds since process boot when a client prompt began waiting on a
    /// human permission decision, or 0 when no wait is open.
    prompt_permission_wait_ms: AtomicU64,
    /// Milliseconds since process boot (monotonic) of the last update forwarded
    /// by the agent-initiated relay, or 0 before it forwards its first.
    ///
    /// Written only by that relay. An agent-initiated turn holds no connection
    /// mutex, never sets `prompt_in_flight`, and does not move `last_active_ms`
    /// — so without this stamp such a session is indistinguishable from an idle
    /// one, and sorts as the stalest, which makes it the pool's first pick.
    agent_relay_ms: AtomicU64,
    /// Milliseconds since process boot (monotonic) at which the agent-initiated
    /// relay started waiting for a permission decision, or 0 when it is not
    /// waiting.
    ///
    /// A permission wait is the one part of such a turn that is *supposed* to
    /// take arbitrarily long: a human is being asked. The relay is parked on
    /// that await, forwarding nothing, so `agent_relay_ms` ages out and the
    /// freshness window alone would hand the session to the eviction scan
    /// precisely while it waits — killing the turn the user is about to
    /// approve. Readers bound this themselves (see the pool's hung threshold);
    /// an open wait is not licence to pin a session forever.
    agent_permission_wait_ms: AtomicU64,
}

impl Default for SessionActivity {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionActivity {
    pub fn new() -> Self {
        Self {
            execution: Default::default(),
            connection_ended: AtomicBool::new(false),
            last_active_ms: AtomicU64::new(Self::now_ms()),
            prompt_in_flight: AtomicBool::new(false),
            prompt_permission_wait_ms: AtomicU64::new(0),
            agent_relay_ms: AtomicU64::new(0),
            agent_permission_wait_ms: AtomicU64::new(0),
        }
    }

    /// Subscriber replacement is not process termination. Shared with idle relays.
    pub fn connection_ended(&self) -> bool {
        self.connection_ended.load(Ordering::Acquire)
    }

    fn mark_connection_ended(&self) {
        self.connection_ended.store(true, Ordering::Release);
        self.execution.set("interrupted");
    }

    /// Monotonic milliseconds since first use (process boot). SystemTime is
    /// unsuitable here: a wall-clock step (NTP, manual change) could make an
    /// active session look hours stale and trigger a false hung eviction.
    fn now_ms() -> u64 {
        use std::sync::OnceLock;
        static BOOT: OnceLock<std::time::Instant> = OnceLock::new();
        BOOT.get_or_init(std::time::Instant::now)
            .elapsed()
            .as_millis() as u64
    }

    pub fn touch(&self) {
        self.last_active_ms.store(Self::now_ms(), Ordering::Release);
    }

    pub fn set_in_flight(&self, in_flight: bool) {
        self.prompt_in_flight.store(in_flight, Ordering::Release);
        self.execution
            .operation(if in_flight { "prompt" } else { "none" });
        if !in_flight && self.prompt_permission_wait_ms.swap(0, Ordering::AcqRel) != 0 {
            self.execution.permission_wait(false);
        }
    }

    /// Milliseconds since process boot of the last observed activity.
    pub fn last_active_ms(&self) -> u64 {
        self.last_active_ms.load(Ordering::Acquire)
    }

    /// Elapsed time since the last observed activity (saturating at zero).
    pub fn age(&self) -> std::time::Duration {
        let last = self.last_active_ms.load(Ordering::Acquire);
        std::time::Duration::from_millis(Self::now_ms().saturating_sub(last))
    }

    pub fn in_flight(&self) -> bool {
        self.prompt_in_flight.load(Ordering::Acquire)
    }

    pub fn begin_prompt_permission_wait(&self) {
        let opened = self.prompt_permission_wait_ms.compare_exchange(
            0,
            Self::now_ms().max(1),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        if opened.is_ok() {
            self.execution.permission_wait(true);
        }
    }

    pub fn end_prompt_permission_wait(&self) {
        if self.prompt_permission_wait_ms.swap(0, Ordering::AcqRel) != 0 {
            self.execution.permission_wait(false);
        }
    }

    pub fn prompt_permission_wait_age(&self) -> Option<std::time::Duration> {
        let started = self.prompt_permission_wait_ms.load(Ordering::Acquire);

        (started != 0)
            .then(|| std::time::Duration::from_millis(Self::now_ms().saturating_sub(started)))
    }

    /// Record that the agent-initiated relay just forwarded an update.
    ///
    /// Clamped away from 0, which is the "never relayed" sentinel: `now_ms` is
    /// milliseconds since process boot, so a relay in the process's first
    /// millisecond would otherwise stamp itself as never having run and hand
    /// the session straight back to the eviction scan.
    pub fn mark_agent_relay(&self) {
        self.agent_relay_ms
            .store(Self::now_ms().max(1), Ordering::Release);
    }

    /// Elapsed time since the relay last forwarded an update, or `None` when it
    /// never has (an ordinary session that only ever served client prompts).
    pub fn agent_relay_age(&self) -> Option<std::time::Duration> {
        let last = self.agent_relay_ms.load(Ordering::Acquire);

        (last != 0).then(|| std::time::Duration::from_millis(Self::now_ms().saturating_sub(last)))
    }

    /// Record that the agent-initiated relay has started waiting for a
    /// permission decision. Idempotent: a re-entry keeps the original start, so
    /// the age readers see is the age of the wait, not of the last call.
    pub fn begin_agent_permission_wait(&self) {
        let opened = self.agent_permission_wait_ms.compare_exchange(
            0,
            Self::now_ms().max(1),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        if opened.is_ok() {
            self.execution.permission_wait(true);
        }
    }

    /// Record that the decision arrived (or the request failed): no wait is open.
    pub fn end_agent_permission_wait(&self) {
        if self.agent_permission_wait_ms.swap(0, Ordering::AcqRel) != 0 {
            self.execution.permission_wait(false);
        }
    }

    /// How long the open permission wait has lasted, or `None` when the relay
    /// is not waiting on one.
    pub fn agent_permission_wait_age(&self) -> Option<std::time::Duration> {
        let started = self.agent_permission_wait_ms.load(Ordering::Acquire);

        (started != 0)
            .then(|| std::time::Duration::from_millis(Self::now_ms().saturating_sub(started)))
    }

    #[cfg(test)]
    pub(crate) fn set_last_active_ms(&self, ms: u64) {
        self.last_active_ms.store(ms, Ordering::Release);
    }

    /// Collapse the phase-timing accessors above into one "what is this session
    /// doing, and for how long" summary, for diagnosing a stalled session without
    /// grepping logs. Precedence when more than one could apply: an open
    /// permission wait explains a silent turn best, so it wins over
    /// `prompt_in_flight`/`agent_relay`, which in turn win over `idle`.
    pub fn wait_phase(&self) -> Value {
        let relay_grace = std::time::Duration::from_secs(super::pool::AGENT_RELAY_GRACE_SECS);
        let (phase, elapsed) = if let Some(age) = self.prompt_permission_wait_age() {
            ("prompt_permission_wait", age)
        } else if let Some(age) = self.agent_permission_wait_age() {
            ("agent_permission_wait", age)
        } else if self.in_flight() {
            ("prompt_in_flight", self.age())
        } else if let Some(age) = self
            .agent_relay_age()
            .filter(|age| super::pool::relay_is_streaming(*age, relay_grace))
        {
            ("agent_relay", age)
        } else {
            ("idle", self.age())
        };
        json!({"phase": phase, "phaseElapsedMs": elapsed.as_millis() as u64})
    }
}

#[derive(Clone)]
pub struct PermissionResponder {
    stdin: Arc<Mutex<ChildStdin>>,
}

impl PermissionResponder {
    pub async fn respond(&self, request_id: u64, outcome: Value) -> Result<()> {
        let reply = JsonRpcResponse::new(request_id, outcome);
        let data = serde_json::to_string(&reply)?;
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(format!("{data}\n").as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }
}

pub struct AcpConnection {
    _proc: Child,
    /// PID of the direct child, used as the process group ID for cleanup.
    child_pgid: Option<i32>,
    stdin: Arc<Mutex<ChildStdin>>,
    next_id: Arc<AtomicU64>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>>,
    notify_tx: NotificationSender,
    /// Session-scoped subscriber for agent-initiated turns, kept apart from
    /// `notify_tx` so it survives a turn that never calls `prompt_done`.
    /// Installed by `prompt_done`; read by the reader loop as a fallback.
    idle_notify_tx: NotificationSender,
    pub acp_session_id: Option<String>,
    pub supports_load_session: bool,
    supports_steering: bool,
    /// Agent name from `initialize` (`agentInfo.name`), e.g. "Kiro CLI Agent".
    /// Used to gate agent-specific extension methods.
    pub agent_name: String,
    pub config_options: Vec<ConfigOption>,
    pub last_active: Instant,
    pub activity: Arc<SessionActivity>,
    pub session_reset: bool,
    /// Dormant Part B scaffolding (https://agentclientprotocol.com/protocol/terminals):
    /// tracks terminals created via the spec's `terminal/*` RPCs. No adapter this
    /// gateway talks to today issues those RPCs (see `terminal.rs`).
    pub terminal: Arc<super::terminal::TerminalManager>,
    _reader_handle: JoinHandle<()>,
    _stderr_handle: Option<JoinHandle<()>>,
    /// Revokes this session's facade token when the connection is dropped, on any evict path.
    /// Held only for its `Drop` side effect (never read).
    ///
    /// It used to cancel a per-session MCP proxy server; that server is gone and the guard now
    /// carries the minted token instead.
    #[cfg(feature = "acp-mcp")]
    #[allow(dead_code)]
    facade_token_guard: Option<tokio_util::sync::DropGuard>,
}

/// Build the final set of env vars for the agent subprocess.
/// `explicit` ([agent].env) takes precedence over `inherit` ([agent].inherit_env).
/// Returns (merged env map, list of keys that were inherited from the process).
fn build_agent_env(
    explicit: &std::collections::HashMap<String, String>,
    inherit_keys: &[String],
) -> (std::collections::HashMap<String, String>, Vec<String>) {
    let mut result: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut inherited: Vec<String> = Vec::new();

    for (k, v) in explicit {
        result.insert(k.clone(), expand_env(v));
    }

    for key in inherit_keys {
        if !result.contains_key(key) {
            if let Ok(v) = std::env::var(key) {
                result.insert(key.clone(), v);
                inherited.push(key.clone());
            }
        }
    }

    (result, inherited)
}

/// Reader loop body: reads JSON-RPC messages from `reader`, resolves pending
/// responses, and forwards agent-initiated requests, notifications, and stale
/// id-bearing messages to the active subscriber. The subscriber owns policy:
/// legacy chat surfaces auto-approve permissions, while opted-in ACP clients
/// can relay the request to their user before responding.
///
/// Only `spawn()`'s production path needs `terminal/*` dispatch, so it goes
/// straight to [`run_reader_loop_with_state_and_terminal`]; this narrower
/// signature remains for tests that don't exercise terminals.
#[cfg(test)]
pub(crate) async fn run_reader_loop_with_state<R>(
    reader: R,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>>,
    notify_tx: NotificationSender,
    idle_notify_tx: NotificationSender,
    execution: Option<Arc<SessionActivity>>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    run_reader_loop_with_state_and_terminal(
        reader,
        pending,
        notify_tx,
        idle_notify_tx,
        execution,
        None,
        None,
    )
    .await
}

/// Same as [`run_reader_loop_with_state`], additionally serving the dormant
/// `terminal/*` RPC family (Part B: https://agentclientprotocol.com/protocol/terminals)
/// directly off `stdin`/`terminal` when both are present. Split out so tests that
/// don't care about terminals keep the simpler signature.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_reader_loop_with_state_and_terminal<R>(
    reader: R,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>>,
    notify_tx: NotificationSender,
    idle_notify_tx: NotificationSender,
    execution: Option<Arc<SessionActivity>>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    terminal: Option<Arc<super::terminal::TerminalManager>>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {}
            Err(e) => {
                error!("reader error: {e}");
                break;
            }
        }
        let mut msg: JsonRpcMessage = match serde_json::from_str(line.trim()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if let Some(activity) = &execution {
            activity.execution.observe_and_stamp(msg.params.as_mut());
        }
        debug!(line = line.trim(), "acp_recv");

        // Response (has id, no method) → resolve pending AND forward to
        // subscriber. An id-bearing message WITH a method is a request FROM
        // the agent (e.g. session/request_permission); its id lives in the
        // agent's own JSON-RPC namespace and must never be matched against
        // our pending map — on a numeric collision the request would be
        // swallowed as the prompt's response, ending the turn with
        // "(no response)" and leaving the agent blocked forever on an answer
        // that never comes.
        if msg.method.is_none() {
            if let Some(id) = msg.id {
                let mut map = pending.lock().await;
                if let Some(tx) = map.remove(&id) {
                    // Forward to subscriber so they see the completion
                    if let Some(ntx) = current_notification_sender(&notify_tx).await {
                        // Clone the essential fields for the subscriber
                        let _ = ntx
                            .send(JsonRpcMessage {
                                id: Some(id),
                                method: None,
                                result: msg.result.clone(),
                                error: msg.error.clone(),
                                params: None,
                            })
                            .await;
                    }
                    let _ = tx.send(msg);
                    continue;
                }
                // Stale id (#732): pending was already abandoned. Falls through
                // to subscriber forwarding; the adapter recv loop filters by
                // request_id so it can't leak into the next prompt.
                trace!(request_id = id, "stale id-bearing message after abandon");
            }
        }

        // Dormant Part B scaffolding: an agent-initiated `terminal/*` request
        // (https://agentclientprotocol.com/protocol/terminals). No adapter this
        // gateway talks to today issues these (see terminal.rs), but if one
        // does, answer it directly here instead of routing it through the
        // chat-turn subscriber — terminal lifecycle is client-local process
        // management, not something a turn's UI needs to see.
        if let (Some(id), Some(method), Some(stdin), Some(terminal)) = (
            msg.id,
            msg.method.as_deref(),
            stdin.clone(),
            terminal.clone(),
        ) {
            if let Some(handler) = terminal_method_handler(method) {
                tokio::spawn(handle_terminal_request(
                    id,
                    handler,
                    msg.params.clone(),
                    stdin,
                    terminal,
                ));
                continue;
            }
        }

        // Notification → forward to the turn's subscriber, and fall back to the
        // session-scoped idle subscriber when that turn is gone.
        //
        // `session_prompt` points `notify_tx` at the running turn and only
        // `prompt_done` hands the session back to the idle subscriber, so a turn
        // that never reaches it — its task dropped mid-flight, or an early
        // return before the recv loop — leaves `notify_tx` holding a sender
        // whose receiver died with that turn's stack frame. Every later
        // agent-initiated turn (a Claude Code background task reporting back, a
        // ScheduleWakeup firing) was then dropped here until the next client
        // prompt: the background listener was reclaimed along with the turn.
        // A closed channel returns the unsent message, so the fallback costs
        // nothing on the hot path and never duplicates a delivery.
        let msg = match current_notification_sender(&notify_tx).await {
            Some(tx) => match tx.send(msg).await {
                Ok(()) => continue,
                Err(unsent) => unsent.0,
            },
            None => msg,
        };
        if let Some(tx) = current_notification_sender(&idle_notify_tx).await {
            let _ = tx.send(msg).await;
        }
    }

    if let Some(activity) = &execution {
        activity.mark_connection_ended();
    }
    // Connection closed — resolve all pending with error
    let mut map = pending.lock().await;
    for (_, tx) in map.drain() {
        let _ = tx.send(JsonRpcMessage {
            id: None,
            method: None,
            result: None,
            error: Some(crate::acp::protocol::JsonRpcError {
                code: -1,
                message: "connection closed".into(),
                data: None,
            }),
            params: None,
        });
    }
    // Close the notify channels so rx.recv() returns None
    *notify_tx.lock().await = None;
    *idle_notify_tx.lock().await = None;
}

type TerminalHandler = for<'a> fn(
    &'a super::terminal::TerminalManager,
    Option<&'a Value>,
) -> std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<Value>> + Send + 'a>,
>;

/// Maps a `terminal/*` method name to its [`super::terminal::TerminalManager`] handler.
fn terminal_method_handler(method: &str) -> Option<TerminalHandler> {
    match method {
        "terminal/create" => Some(|m, p| Box::pin(m.create(p))),
        "terminal/output" => Some(|m, p| Box::pin(m.output(p))),
        "terminal/wait_for_exit" => Some(|m, p| Box::pin(m.wait_for_exit(p))),
        "terminal/kill" => Some(|m, p| Box::pin(m.kill(p))),
        "terminal/release" => Some(|m, p| Box::pin(m.release(p))),
        _ => None,
    }
}

/// Run one `terminal/*` handler and write its JSON-RPC response back to the
/// agent. Spawned per-request so a slow `terminal/wait_for_exit` never blocks
/// the reader loop from processing the agent's other traffic.
async fn handle_terminal_request(
    id: u64,
    handler: TerminalHandler,
    params: Option<Value>,
    stdin: Arc<Mutex<ChildStdin>>,
    terminal: Arc<super::terminal::TerminalManager>,
) {
    let response = match handler(&terminal, params.as_ref()).await {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err(err) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": -32000, "message": err.to_string()},
        }),
    };
    if let Ok(data) = serde_json::to_string(&response) {
        let _ = write_to_stdin(&stdin, &data).await;
    }
}

/// Bounded raw write to an agent's stdin, mirroring [`AcpConnection::send_raw`].
/// Standalone because the terminal RPC handlers run detached from an
/// `AcpConnection` borrow (they own only an `Arc` clone of its stdin).
async fn write_to_stdin(stdin: &Arc<Mutex<ChildStdin>>, data: &str) -> Result<()> {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let mut w = stdin.lock().await;
        w.write_all(data.as_bytes()).await?;
        w.write_all(b"\n").await?;
        w.flush().await?;
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|_| anyhow!("stdin write timeout"))??;
    Ok(())
}

/// Build a `Command` with the security baseline shared by every subprocess this
/// crate spawns (the agent process itself and, for the dormant `terminal/*` RPC
/// scaffolding, terminals the agent asks the client to create): its own process
/// group for tree-wide kill, a cleared environment, and the minimal HOME/PATH/
/// user vars a subprocess needs to function. Callers layer stdio and any
/// additional env on top.
pub(crate) fn baseline_command(
    command: &str,
    args: &[String],
    working_dir: &str,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(command);
    cmd.args(args).current_dir(working_dir);
    // Create a new process group so we can kill the entire tree.
    // SAFETY: setpgid is async-signal-safe (POSIX.1-2008) and called
    // before exec. Return value checked — failure means the child won't
    // have its own process group, so kill(-pgid) would be unsafe.
    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(0x00000200); // CREATE_NEW_PROCESS_GROUP
    }
    // Clear inherited env to prevent credential leakage (e.g. DISCORD_BOT_TOKEN).
    // Only explicit values + essential baseline vars are passed through.
    cmd.env_clear();
    // Preserve the real HOME so agents/terminals can find OAuth/auth files
    // (~/.codex, ~/.claude, ~/.config/gh, etc.). working_dir is already set via
    // current_dir() above and is not necessarily the user's home directory.
    cmd.env(
        "HOME",
        std::env::var("HOME").unwrap_or_else(|_| working_dir.into()),
    );
    cmd.env(
        "PATH",
        std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into()),
    );
    #[cfg(unix)]
    {
        cmd.env(
            "USER",
            std::env::var("USER").unwrap_or_else(|_| "agent".into()),
        );
    }
    #[cfg(windows)]
    {
        // Windows requires SystemRoot for DLL loading and basic OS functionality.
        // USERPROFILE is the Windows equivalent of HOME.
        cmd.env(
            "USERPROFILE",
            std::env::var("USERPROFILE").unwrap_or_else(|_| working_dir.into()),
        );
        cmd.env(
            "USERNAME",
            std::env::var("USERNAME").unwrap_or_else(|_| "agent".into()),
        );
        if let Ok(v) = std::env::var("SystemRoot") {
            cmd.env("SystemRoot", v);
        }
        if let Ok(v) = std::env::var("SystemDrive") {
            cmd.env("SystemDrive", v);
        }
    }
    cmd
}

/// SIGTERM → SIGKILL a process group. Shared by the agent connection's own
/// teardown and the `terminal/kill` / `terminal/release` RPC handlers.
/// Uses std::thread (not tokio::spawn) so SIGKILL fires even during
/// runtime shutdown or panic unwinding.
pub(crate) fn kill_process_group(pgid: i32) {
    if pgid <= 0 {
        return;
    }
    #[cfg(unix)]
    {
        // Stage 1: SIGTERM the process group
        unsafe {
            libc::kill(-pgid, libc::SIGTERM);
        }
        // Stage 2: SIGKILL after brief grace (std::thread survives runtime shutdown)
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
            }
        });
    }
    #[cfg(not(unix))]
    {
        let _ = pgid; // suppress unused warning on Windows
    }
}

impl AcpConnection {
    pub async fn spawn(
        command: &str,
        args: &[String],
        working_dir: &str,
        env: &std::collections::HashMap<String, String>,
        inherit_env: &[String],
    ) -> Result<Self> {
        info!(cmd = command, ?args, cwd = working_dir, "spawning agent");

        let mut cmd = baseline_command(command, args, working_dir);
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        for (k, v) in env {
            cmd.env(k, expand_env(v));
        }
        // Inherit selected env vars from the OAB process (e.g. vars injected
        // via Kubernetes envFrom).  Keys already in [agent].env are skipped —
        // explicit values take precedence.
        let (agent_env, inherited_keys) = build_agent_env(env, inherit_env);
        for (k, v) in &agent_env {
            cmd.env(k, v);
        }
        if !agent_env.is_empty() {
            let explicit_keys: Vec<&String> = env.keys().collect();
            tracing::warn!(
                ?explicit_keys,
                ?inherited_keys,
                "[agent].env/inherit_env is set -- these values are accessible to the agent and could be exfiltrated via prompt injection"
            );
        }
        let mut proc = cmd
            .spawn()
            .map_err(|e| anyhow!("failed to spawn {command}: {e}"))?;
        let child_pgid = proc.id().and_then(|pid| i32::try_from(pid).ok());

        let stdout = proc.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let stdin = proc.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdin = Arc::new(Mutex::new(stdin));

        // Capture agent stderr and log it (ACP spec: agents MAY write to stderr
        // for logging; clients MAY capture or ignore it).
        let stderr_handle = if let Some(stderr) = proc.stderr.take() {
            let cmd_name = command.to_string();
            Some(tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                let sanitized: String = trimmed
                                    .chars()
                                    .filter(|c| !c.is_control() || *c == '\t')
                                    .collect();
                                if !sanitized.is_empty() {
                                    tracing::warn!(agent = %cmd_name, "{sanitized}");
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
            }))
        } else {
            None
        };

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let notify_tx: Arc<Mutex<Option<mpsc::Sender<JsonRpcMessage>>>> =
            Arc::new(Mutex::new(None));
        let idle_notify_tx: Arc<Mutex<Option<mpsc::Sender<JsonRpcMessage>>>> =
            Arc::new(Mutex::new(None));

        let activity = Arc::new(SessionActivity::new());
        let terminal = Arc::new(super::terminal::TerminalManager::new());
        let reader_handle = tokio::spawn(run_reader_loop_with_state_and_terminal(
            stdout,
            pending.clone(),
            notify_tx.clone(),
            idle_notify_tx.clone(),
            Some(activity.clone()),
            Some(stdin.clone()),
            Some(terminal.clone()),
        ));

        Ok(Self {
            _proc: proc,
            child_pgid,
            stdin,
            next_id: Arc::new(AtomicU64::new(1)),
            pending,
            notify_tx,
            idle_notify_tx,
            acp_session_id: None,
            supports_load_session: false,
            supports_steering: false,
            agent_name: String::new(),
            config_options: Vec::new(),
            last_active: Instant::now(),
            activity,
            session_reset: false,
            terminal,
            _reader_handle: reader_handle,
            _stderr_handle: stderr_handle,
            #[cfg(feature = "acp-mcp")]
            facade_token_guard: None,
        })
    }

    /// Attach the guard that revokes this session's facade token when the connection drops.
    #[cfg(feature = "acp-mcp")]
    pub fn set_facade_token_guard(&mut self, guard: Option<tokio_util::sync::DropGuard>) {
        self.facade_token_guard = guard;
    }

    /// Independent request handle: steering must not wait for the prompt mutex.
    pub(crate) fn steering_handle(&self) -> Option<crate::acp::steering::SteeringHandle> {
        self.supports_steering
            .then(|| crate::acp::steering::SteeringHandle {
                stdin: self.stdin.clone(),
                next_id: self.next_id.clone(),
                pending: self.pending.clone(),
                session_id: self.acp_session_id.clone().unwrap_or_default(),
            })
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub(crate) async fn send_raw(&self, data: &str) -> Result<()> {
        debug!(data = data.trim(), "acp_send");
        // A hung agent can stop draining stdin; bound the write so callers
        // (and the mutexes they hold) can never block on it indefinitely.
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            let mut w = self.stdin.lock().await;
            w.write_all(data.as_bytes()).await?;
            w.write_all(b"\n").await?;
            w.flush().await?;
            Ok::<(), anyhow::Error>(())
        })
        .await
        .map_err(|_| anyhow!("stdin write timeout"))??;
        Ok(())
    }

    async fn send_request(&self, method: &str, params: Option<Value>) -> Result<JsonRpcMessage> {
        let resp = self.send_request_response(method, params).await?;
        if let Some(err) = &resp.error {
            return Err(anyhow!("{err}"));
        }
        Ok(resp)
    }

    /// Preserve explicit agent errors separately from a missing response.
    async fn send_request_response(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<JsonRpcMessage> {
        let id = self.next_id();
        let req = JsonRpcRequest::new(id, method, params);
        let data = serde_json::to_string(&req)?;

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        self.send_raw(&data).await?;

        let timeout_secs = if method == "session/new" { 120 } else { 30 };
        let resp = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx)
            .await
            .map_err(|_| anyhow!("timeout waiting for {method} response"))?
            .map_err(|_| anyhow!("channel closed waiting for {method}"))?;

        // The reader synthesizes an id-less error when stdout closes. It is
        // not an agent acknowledgement and cannot confirm a write's outcome.
        if resp.id.is_none() {
            return Err(anyhow!("connection closed waiting for {method}"));
        }
        Ok(resp)
    }

    pub async fn initialize(&mut self) -> Result<()> {
        let resp = self
            .send_request(
                "initialize",
                Some(json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        // Spec capability (agentclientprotocol.com/protocol/terminals).
                        // Neither adapter this gateway runs against today reads it; see
                        // `terminal_output` below, which is what they actually gate on.
                        "terminal": true,
                        "_meta": {
                            "jetbrains": {
                                "air": {
                                    "version": 1,
                                    "capabilities": ["asyncTasks"]
                                }
                            },
                            // Zed's own client-capability convention (claude-agent-acp is
                            // published from zed-industries/claude-code-acp), not part of the
                            // ACP spec. claude-agent-acp 0.74.0 and codex-acp 1.1.4 both gate
                            // terminal behavior on this instead of `terminal` above.
                            "terminal_output": true
                        }
                    },
                    "clientInfo": {"name": "openab", "version": "0.1.0"},
                })),
            )
            .await?;

        let result = resp.result.as_ref();
        let agent_name = result
            .and_then(|r| r.get("agentInfo"))
            .and_then(|a| a.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("unknown");
        self.agent_name = agent_name.to_string();
        self.supports_steering = result
            .and_then(|r| r.pointer("/_meta/steering/supported"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        self.supports_load_session = result
            .and_then(|r| r.get("agentCapabilities"))
            .and_then(|c| c.get("loadSession"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        info!(
            agent = agent_name,
            load_session = self.supports_load_session,
            "initialized"
        );
        Ok(())
    }

    pub async fn session_new(
        &mut self,
        cwd: &str,
        mcp_servers: &[serde_json::Value],
        session_meta: Option<&serde_json::Value>,
    ) -> Result<String> {
        let resp = self
            .send_request(
                "session/new",
                Some(session_new_params(cwd, mcp_servers, session_meta)),
            )
            .await?;

        let session_id = resp
            .result
            .as_ref()
            .and_then(|r| r.get("sessionId"))
            .and_then(|s| s.as_str())
            .ok_or_else(|| anyhow!("no sessionId in session/new response"))?
            .to_string();

        info!(session_id = %session_id, "session created");
        self.acp_session_id = Some(session_id.clone());
        if let Some(result) = resp.result.as_ref() {
            self.config_options = parse_config_options(result);
            if !self.config_options.is_empty() {
                info!(count = self.config_options.len(), "parsed configOptions");
            }
        }
        self.activity.execution.initialized();
        Ok(session_id)
    }

    /// Set a config option (e.g. model, mode) via ACP session/set_config_option.
    /// Returns the updated list of all config options.
    pub async fn set_config_option(
        &mut self,
        config_id: &str,
        value: &str,
    ) -> Result<Vec<ConfigOption>> {
        let session_id = self
            .acp_session_id
            .as_ref()
            .ok_or_else(|| anyhow!("no session"))?
            .clone();

        let resp = self
            .send_request(
                "session/set_config_option",
                Some(json!({
                    "sessionId": session_id,
                    "configId": config_id,
                    "value": value,
                })),
            )
            .await;

        match resp {
            Ok(r) => {
                if let Some(result) = r.result.as_ref() {
                    self.config_options = parse_config_options(result);
                }
                info!(config_id, value, "config option set");
            }
            Err(_) => {
                // Fall back: send as a slash command (e.g. "/model claude-sonnet-4")
                let cmd = format!("/{config_id} {value}");
                info!(
                    cmd,
                    "set_config_option not supported, falling back to prompt"
                );
                let _resp = self
                    .send_request(
                        "session/prompt",
                        Some(json!({
                            "sessionId": session_id,
                            "prompt": [{"type": "text", "text": cmd}],
                        })),
                    )
                    .await?;
                for opt in &mut self.config_options {
                    if opt.id == config_id {
                        opt.current_value = value.to_string();
                    }
                }
            }
        }

        Ok(self.config_options.clone())
    }

    /// Strict configuration control for API clients. Never synthesize success or
    /// send a slash-command prompt when the agent rejects a setting.
    pub async fn set_config_option_strict(
        &mut self,
        config_id: &str,
        value: &str,
    ) -> Result<Vec<ConfigOption>> {
        let session_id = self
            .acp_session_id
            .as_ref()
            .ok_or_else(|| anyhow!("no session"))?
            .clone();
        let response = self
            .send_request_response(
                "session/set_config_option",
                Some(json!({
                    "sessionId": session_id, "configId": config_id, "value": value,
                })),
            )
            .await;
        match response {
            Ok(response) => {
                if let Some(error) = response.error {
                    // An explicit rejection leaves the last acknowledged state
                    // usable, so a subsequent valid selection can be retried.
                    return Err(anyhow!("{error}"));
                }
                let options = response
                    .result
                    .as_ref()
                    .map(parse_config_options)
                    .unwrap_or_default();
                self.config_options = options;
                if self.config_options.is_empty() {
                    return Err(anyhow!("agent did not return configuration options"));
                }
                Ok(self.config_options.clone())
            }
            Err(error) => {
                // A lost response may have applied: stop advertising the old
                // value until the agent next publishes its actual state.
                self.config_options.clear();
                Err(error)
            }
        }
    }

    /// Query account-level usage/billing via kiro-cli's
    /// `_kiro.dev/commands/execute` extension (the `/usage` slash command).
    ///
    /// This is a Kiro-specific extension, not part of the ACP spec, and the
    /// request shape is strict: a malformed `command` value is a
    /// deserialization error that kills the whole ACP connection (no JSON-RPC
    /// error is returned). We therefore gate on the agent name advertised in
    /// `initialize` and never retry on failure.
    pub async fn get_usage(&mut self) -> Result<UsageReport> {
        if !self.agent_name.to_ascii_lowercase().contains("kiro") {
            return Err(anyhow!(
                "usage query is not supported by this backend ({})",
                if self.agent_name.is_empty() {
                    "unknown agent"
                } else {
                    &self.agent_name
                }
            ));
        }
        let session_id = self
            .acp_session_id
            .as_ref()
            .ok_or_else(|| anyhow!("no session"))?
            .clone();

        let resp = self
            .send_request(
                "_kiro.dev/commands/execute",
                Some(json!({
                    "sessionId": session_id,
                    // Adjacently-tagged TuiCommand enum: tag = "command", content = "args".
                    "command": {"command": "usage", "args": {}},
                })),
            )
            .await?;

        let result = resp
            .result
            .as_ref()
            .ok_or_else(|| anyhow!("empty usage response"))?;
        parse_usage_report(result)
            .ok_or_else(|| anyhow!("could not parse usage response from agent"))
    }

    /// Send a prompt with content blocks (text and/or images) and return a receiver
    /// for streaming notifications. The final message on the channel will have id set
    /// (the prompt response).
    pub async fn session_prompt(
        &mut self,
        content_blocks: Vec<ContentBlock>,
    ) -> Result<(mpsc::Receiver<JsonRpcMessage>, u64)> {
        self.last_active = Instant::now();
        self.activity.touch();
        self.activity.end_prompt_permission_wait();
        self.activity.set_in_flight(true);

        let session_id = self
            .acp_session_id
            .as_ref()
            .ok_or_else(|| anyhow!("no session"))?;

        let (tx, rx) = mpsc::channel(ACP_NOTIFICATION_CAPACITY);
        *self.notify_tx.lock().await = Some(tx);

        let id = self.next_id();

        // Convert content blocks to JSON
        let prompt_json: Vec<Value> = content_blocks.iter().map(|b| b.to_json()).collect();

        let req = JsonRpcRequest::new(
            id,
            "session/prompt",
            Some(json!({
                "sessionId": session_id,
                "prompt": prompt_json,
            })),
        );
        let data = serde_json::to_string(&req)?;

        let (resp_tx, _resp_rx) = oneshot::channel();
        self.pending.lock().await.insert(id, resp_tx);

        self.send_raw(&data).await?;
        Ok((rx, id))
    }

    /// Call after prompt streaming is done. ACP agents may emit session updates
    /// while no client prompt is in flight (for example Claude Code scheduled
    /// wakeups), so callers can atomically replace the turn subscriber with a
    /// session-idle subscriber instead of leaving a delivery gap.
    pub async fn prompt_done(&mut self, idle_subscriber: Option<mpsc::Sender<JsonRpcMessage>>) {
        // Recorded separately as well: the next `session_prompt` overwrites
        // `notify_tx` with that turn's route, and if the turn never gets back
        // here the reader loop needs somewhere to send agent-initiated updates
        // that is not the dead turn.
        *self.idle_notify_tx.lock().await = idle_subscriber.clone();
        *self.notify_tx.lock().await = idle_subscriber;
        self.activity.touch();
        self.activity.set_in_flight(false);
        self.last_active = Instant::now();
    }

    /// Drop the pending entry for `request_id` and best-effort send
    /// `session/cancel` as a JSON-RPC notification (no id; per ACP spec the
    /// agent does not reply). Errors are swallowed: the agent process may
    /// already be dead, in which case the stdin write fails harmlessly.
    /// See #732.
    pub async fn abandon_request(&self, request_id: u64) {
        self.pending.lock().await.remove(&request_id);
        let Some(session_id) = self.acp_session_id.as_deref() else {
            return;
        };
        let req = json!({
            "jsonrpc": "2.0",
            "method": "session/cancel",
            "params": {"sessionId": session_id},
        });
        if let Ok(data) = serde_json::to_string(&req) {
            let _ = self.send_raw(&data).await;
        }
    }

    /// Return a clone of the stdin handle for lock-free cancel.
    pub fn cancel_handle(&self) -> Arc<Mutex<ChildStdin>> {
        Arc::clone(&self.stdin)
    }

    pub fn permission_responder(&self) -> PermissionResponder {
        PermissionResponder {
            stdin: Arc::clone(&self.stdin),
        }
    }

    pub fn activity_handle(&self) -> Arc<SessionActivity> {
        Arc::clone(&self.activity)
    }

    /// Process-group id of the agent child, readable without any lock state.
    pub fn child_pgid(&self) -> Option<i32> {
        self.child_pgid
    }

    pub fn alive(&self) -> bool {
        !self._reader_handle.is_finished()
    }

    /// Resume a previous session by ID. Returns Ok(()) if the agent accepted
    /// the load, or an error if it failed (caller should fall back to session/new).
    pub async fn session_load(
        &mut self,
        session_id: &str,
        cwd: &str,
        mcp_servers: &[serde_json::Value],
        session_meta: Option<&serde_json::Value>,
    ) -> Result<()> {
        let resp = self
            .send_request(
                "session/load",
                Some(session_load_params(
                    session_id,
                    cwd,
                    mcp_servers,
                    session_meta,
                )),
            )
            .await?;
        // Accept any non-error response as success
        if resp.error.is_some() {
            return Err(anyhow!("session/load rejected"));
        }
        info!(session_id, "session loaded");
        self.acp_session_id = Some(session_id.to_string());
        if let Some(result) = resp.result.as_ref() {
            self.config_options = parse_config_options(result);
        }
        self.activity.execution.initialized();
        Ok(())
    }

    /// Kill the entire process group: SIGTERM → SIGKILL.
    fn kill_process_group(&mut self) {
        if let Some(pgid) = self.child_pgid {
            kill_process_group(pgid);
        }
    }
}

/// `session/new` params. `mcp_servers` are client-declared http-type entries
/// forwarded verbatim (ACP passthrough); empty for every other caller.
/// `session_meta` is the client's `_meta` object, forwarded verbatim when
/// present (claude-agent-acp reads e.g. `_meta.systemPrompt`); `None` omits the key.
fn session_new_params(
    cwd: &str,
    mcp_servers: &[serde_json::Value],
    session_meta: Option<&serde_json::Value>,
) -> serde_json::Value {
    let mut params = json!({"cwd": cwd, "mcpServers": mcp_servers});
    if let Some(meta) = session_meta {
        params["_meta"] = meta.clone();
    }
    params
}

/// `session/load` params — same `mcpServers` / `_meta` passthrough as `session_new_params`.
fn session_load_params(
    session_id: &str,
    cwd: &str,
    mcp_servers: &[serde_json::Value],
    session_meta: Option<&serde_json::Value>,
) -> serde_json::Value {
    let mut params = json!({"sessionId": session_id, "cwd": cwd, "mcpServers": mcp_servers});
    if let Some(meta) = session_meta {
        params["_meta"] = meta.clone();
    }
    params
}

impl Drop for AcpConnection {
    fn drop(&mut self) {
        self.activity.mark_connection_ended();
        if let Some(handle) = self._stderr_handle.take() {
            handle.abort();
        }
        self.kill_process_group();
        // Terminals are tracked independently of the agent process; a terminal
        // the agent never `terminal/release`d must not outlive this connection.
        self.terminal.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_agent_env, build_permission_response, pick_best_option, session_load_params,
        session_new_params,
    };
    use serde_json::json;

    #[test]
    fn session_new_params_carry_the_passed_mcp_servers_verbatim() {
        let servers = vec![json!({
            "name": "nuphos-credentials",
            "type": "http",
            "url": "https://x.example/mcp",
            "headers": [{"name": "Authorization", "value": "Bearer t"}]
        })];
        assert_eq!(
            session_new_params("/w", &servers, None),
            json!({"cwd": "/w", "mcpServers": servers})
        );
        // No declaration → the historical empty array, unchanged on the wire.
        assert_eq!(
            session_new_params("/w", &[], None),
            json!({"cwd": "/w", "mcpServers": []})
        );
    }

    #[test]
    fn session_new_params_carry_the_passed_meta_verbatim_and_omit_it_when_none() {
        let meta = json!({"systemPrompt": "be terse", "nested": {"k": [1, 2]}});
        assert_eq!(
            session_new_params("/w", &[], Some(&meta)),
            json!({"cwd": "/w", "mcpServers": [], "_meta": meta})
        );
        assert!(session_new_params("/w", &[], None).get("_meta").is_none());
    }

    #[test]
    fn session_load_params_carry_the_passed_meta_verbatim_and_omit_it_when_none() {
        let meta = json!({"systemPrompt": "be terse"});
        assert_eq!(
            session_load_params("sess_1", "/w", &[], Some(&meta)),
            json!({"sessionId": "sess_1", "cwd": "/w", "mcpServers": [], "_meta": meta})
        );
        assert!(session_load_params("sess_1", "/w", &[], None)
            .get("_meta")
            .is_none());
    }

    #[test]
    fn session_load_params_carry_the_passed_mcp_servers_verbatim() {
        let servers = vec![json!({"name": "s", "type": "http", "url": "https://x/mcp"})];
        assert_eq!(
            session_load_params("sess_1", "/w", &servers, None),
            json!({"sessionId": "sess_1", "cwd": "/w", "mcpServers": servers})
        );
        assert_eq!(
            session_load_params("sess_1", "/w", &[], None),
            json!({"sessionId": "sess_1", "cwd": "/w", "mcpServers": []})
        );
    }

    #[test]
    fn picks_allow_always_over_other_options() {
        let options = vec![
            json!({"kind": "allow_once", "optionId": "once"}),
            json!({"kind": "allow_always", "optionId": "always"}),
            json!({"kind": "reject_once", "optionId": "reject"}),
        ];

        assert_eq!(pick_best_option(&options), Some("always".to_string()));
    }

    #[test]
    fn falls_back_to_first_unknown_non_reject_kind() {
        let options = vec![
            json!({"kind": "reject_once", "optionId": "reject"}),
            json!({"kind": "workspace_write", "optionId": "workspace-write"}),
        ];

        assert_eq!(
            pick_best_option(&options),
            Some("workspace-write".to_string())
        );
    }

    #[test]
    fn selects_bypass_permissions_for_exit_plan_mode() {
        let options = vec![
            json!({"optionId": "bypassPermissions", "kind": "allow_always"}),
            json!({"optionId": "acceptEdits", "kind": "allow_always"}),
            json!({"optionId": "default", "kind": "allow_once"}),
            json!({"optionId": "plan", "kind": "reject_once"}),
        ];

        assert_eq!(
            pick_best_option(&options),
            Some("bypassPermissions".to_string())
        );
    }

    #[test]
    fn returns_none_when_only_reject_options_exist() {
        let options = vec![
            json!({"kind": "reject_once", "optionId": "reject-once"}),
            json!({"kind": "reject_always", "optionId": "reject-always"}),
        ];

        assert_eq!(pick_best_option(&options), None);
    }

    #[test]
    fn builds_cancelled_outcome_when_no_selectable_option_exists() {
        let response = build_permission_response(Some(&json!({
            "options": [
                {"kind": "reject_once", "optionId": "reject-once"}
            ]
        })));

        assert_eq!(response, json!({"outcome": {"outcome": "cancelled"}}));
    }

    #[test]
    fn builds_cancelled_when_options_array_is_empty() {
        let response = build_permission_response(Some(&json!({
            "options": []
        })));

        assert_eq!(response, json!({"outcome": {"outcome": "cancelled"}}));
    }

    #[test]
    fn falls_back_to_allow_always_when_options_are_missing() {
        let response = build_permission_response(Some(&json!({
            "toolCall": {"title": "legacy"}
        })));

        assert_eq!(
            response,
            json!({"outcome": {"outcome": "selected", "optionId": "allow_always"}})
        );
    }

    #[test]
    fn falls_back_to_allow_always_when_params_is_none() {
        let response = build_permission_response(None);

        assert_eq!(
            response,
            json!({"outcome": {"outcome": "selected", "optionId": "allow_always"}})
        );
    }

    #[test]
    fn explicit_env_takes_precedence_over_inherit_env() {
        let key = "OAB_TEST_PRECEDENCE";
        std::env::set_var(key, "from_process");
        let mut explicit = std::collections::HashMap::new();
        explicit.insert(key.to_string(), "from_config".to_string());
        let inherit = vec![key.to_string()];

        let (result, inherited) = build_agent_env(&explicit, &inherit);

        assert_eq!(result.get(key).unwrap(), "from_config");
        assert!(!inherited.contains(&key.to_string()));
        std::env::remove_var(key);
    }

    #[test]
    fn inherit_env_copies_from_process() {
        let key = "OAB_TEST_INHERIT";
        std::env::set_var(key, "process_value");
        let explicit = std::collections::HashMap::new();
        let inherit = vec![key.to_string()];

        let (result, inherited) = build_agent_env(&explicit, &inherit);

        assert_eq!(result.get(key).unwrap(), "process_value");
        assert!(inherited.contains(&key.to_string()));
        std::env::remove_var(key);
    }

    #[test]
    fn inherit_env_skips_missing_vars() {
        let explicit = std::collections::HashMap::new();
        let inherit = vec!["OAB_TEST_NONEXISTENT_VAR_12345".to_string()];

        let (result, inherited) = build_agent_env(&explicit, &inherit);

        assert!(!result.contains_key("OAB_TEST_NONEXISTENT_VAR_12345"));
        assert!(inherited.is_empty());
    }
}

#[cfg(test)]
mod reader_loop_tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::io::{duplex, AsyncWriteExt};
    use tokio::sync::{mpsc, oneshot, Mutex};

    #[tokio::test]
    async fn permission_request_is_forwarded_to_the_active_subscriber() {
        let (agent_side, broker_side) = duplex(4096);
        let (broker_reader, _broker_writer) = tokio::io::split(broker_side);
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (notify_tx, mut notify_rx) = mpsc::channel(1);
        let subscriber: NotificationSender = Arc::new(Mutex::new(Some(notify_tx)));

        let idle: NotificationSender = Arc::new(Mutex::new(None));
        let reader = tokio::spawn(run_reader_loop(broker_reader, pending, subscriber, idle));
        let (_agent_reader, mut agent_writer) = tokio::io::split(agent_side);
        agent_writer
            .write_all(
                br#"{"jsonrpc":"2.0","id":41,"method":"session/request_permission","params":{"sessionId":"inner","toolCall":{"title":"kubectl patch"},"options":[{"optionId":"allow","kind":"allow_once"},{"optionId":"reject","kind":"reject_once"}]}}"#,
            )
            .await
            .unwrap();
        agent_writer.write_all(b"\n").await.unwrap();

        let forwarded =
            tokio::time::timeout(std::time::Duration::from_millis(100), notify_rx.recv())
                .await
                .expect("permission request must not be consumed by the broker")
                .expect("subscriber must remain connected");
        assert_eq!(forwarded.id, Some(41));
        assert_eq!(
            forwarded.method.as_deref(),
            Some("session/request_permission")
        );

        reader.abort();
    }

    // The agent numbers its own requests independently of the broker's ids.
    // When an agent request id collides with a pending broker request id, the
    // request must still reach the subscriber as a request — not resolve the
    // pending entry as if it were the response (which ended real turns with
    // "(no response)" and left the agent blocked forever on the permission).
    #[tokio::test]
    async fn agent_request_with_colliding_id_does_not_resolve_pending() {
        let (agent_side, broker_side) = duplex(4096);
        let (broker_reader, _broker_writer) = tokio::io::split(broker_side);
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (prompt_tx, mut prompt_rx) = oneshot::channel();
        pending.lock().await.insert(3u64, prompt_tx);
        let (notify_tx, mut notify_rx) = mpsc::channel(4);
        let subscriber: NotificationSender = Arc::new(Mutex::new(Some(notify_tx)));

        let idle: NotificationSender = Arc::new(Mutex::new(None));
        let reader = tokio::spawn(run_reader_loop(
            broker_reader,
            pending.clone(),
            subscriber,
            idle,
        ));
        let (_agent_reader, mut agent_writer) = tokio::io::split(agent_side);
        // Agent-initiated request whose id collides with the pending prompt id 3.
        agent_writer
            .write_all(
                br#"{"jsonrpc":"2.0","id":3,"method":"session/request_permission","params":{"sessionId":"inner","options":[{"optionId":"allow","kind":"allow_once"}]}}"#,
            )
            .await
            .unwrap();
        agent_writer.write_all(b"\n").await.unwrap();

        let forwarded =
            tokio::time::timeout(std::time::Duration::from_millis(100), notify_rx.recv())
                .await
                .expect("colliding request must be forwarded, not swallowed")
                .expect("subscriber must remain connected");
        assert_eq!(
            forwarded.method.as_deref(),
            Some("session/request_permission"),
            "the request must keep its method so the recv loop can answer it"
        );
        assert!(
            pending.lock().await.contains_key(&3),
            "the pending prompt must remain unresolved"
        );
        assert!(
            prompt_rx.try_recv().is_err(),
            "the prompt oneshot must not fire from the agent's request"
        );

        // The real response (no method) still resolves the pending entry.
        agent_writer
            .write_all(br#"{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}"#)
            .await
            .unwrap();
        agent_writer.write_all(b"\n").await.unwrap();
        let resolved = tokio::time::timeout(std::time::Duration::from_millis(100), prompt_rx)
            .await
            .expect("response must resolve the pending prompt")
            .expect("oneshot must deliver");
        assert!(resolved.result.is_some());

        reader.abort();
    }

    #[tokio::test]
    async fn notification_channel_backpressures_at_capacity() {
        let (tx, mut rx) = mpsc::channel::<JsonRpcMessage>(ACP_NOTIFICATION_CAPACITY);
        let message = || JsonRpcMessage {
            id: None,
            method: Some("session/update".into()),
            result: None,
            error: None,
            params: None,
        };

        for _ in 0..ACP_NOTIFICATION_CAPACITY {
            tx.send(message()).await.unwrap();
        }
        let mut blocked = Box::pin(tx.send(message()));

        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), &mut blocked)
                .await
                .is_err(),
            "a full subscriber channel must apply backpressure"
        );
        rx.recv().await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), blocked)
            .await
            .expect("send should resume after capacity is released")
            .unwrap();
    }

    #[tokio::test]
    async fn blocked_notification_send_does_not_hold_subscriber_lock() {
        let (tx, _rx) = mpsc::channel::<JsonRpcMessage>(1);
        tx.send(JsonRpcMessage {
            id: None,
            method: Some("session/update".into()),
            result: None,
            error: None,
            params: None,
        })
        .await
        .unwrap();
        let notify_tx: NotificationSender = Arc::new(Mutex::new(Some(tx)));
        let sender = current_notification_sender(&notify_tx).await.unwrap();
        let blocked = tokio::spawn(async move {
            sender
                .send(JsonRpcMessage {
                    id: None,
                    method: Some("session/update".into()),
                    result: None,
                    error: None,
                    params: None,
                })
                .await
        });

        tokio::task::yield_now().await;
        let _guard = tokio::time::timeout(std::time::Duration::from_millis(100), notify_tx.lock())
            .await
            .expect("subscriber replacement must not wait for channel capacity");
        blocked.abort();
    }

    /// #732 stale-id path: when a response arrives for an id the broker has
    /// already abandoned, the reader must (a) not crash, (b) leave `pending`
    /// untouched, and (c) still forward the message to whoever is currently
    /// subscribed — the adapter recv loop is responsible for filtering by
    /// request_id so the stray response never leaks into the next prompt.
    #[tokio::test]
    async fn stale_id_response_is_forwarded_without_pending_entry() {
        let (mut agent_stdout_writer, agent_stdout_reader) = duplex(8 * 1024);
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let notify_tx: Arc<Mutex<Option<mpsc::Sender<JsonRpcMessage>>>> =
            Arc::new(Mutex::new(None));

        let (sub_tx, mut sub_rx) = mpsc::channel(ACP_NOTIFICATION_CAPACITY);
        *notify_tx.lock().await = Some(sub_tx);

        let handle = tokio::spawn(run_reader_loop(
            agent_stdout_reader,
            pending.clone(),
            notify_tx.clone(),
            Arc::new(Mutex::new(None)),
        ));

        let stale = b"{\"jsonrpc\":\"2.0\",\"id\":42,\"result\":{\"stopReason\":\"ok\"}}\n";
        agent_stdout_writer.write_all(stale).await.unwrap();
        agent_stdout_writer.flush().await.unwrap();

        let forwarded = tokio::time::timeout(std::time::Duration::from_secs(2), sub_rx.recv())
            .await
            .expect("subscriber should receive stale message before timeout")
            .expect("subscriber channel should not be closed");
        assert_eq!(forwarded.id, Some(42));
        assert!(pending.lock().await.is_empty());

        drop(agent_stdout_writer);
        handle.await.unwrap();
    }

    /// Matched-id path: when a response's id is in `pending`, the loop must
    /// resolve the oneshot AND forward a copy to the subscriber so the
    /// adapter's recv loop sees the completion. Guards against regressions
    /// that would suppress the forward branch while keeping resolve.
    #[tokio::test]
    async fn matched_id_response_resolves_pending_and_forwards() {
        let (mut agent_stdout_writer, agent_stdout_reader) = duplex(8 * 1024);
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let notify_tx: Arc<Mutex<Option<mpsc::Sender<JsonRpcMessage>>>> =
            Arc::new(Mutex::new(None));

        let (resp_tx, resp_rx) = oneshot::channel();
        pending.lock().await.insert(7, resp_tx);

        let (sub_tx, mut sub_rx) = mpsc::channel(ACP_NOTIFICATION_CAPACITY);
        *notify_tx.lock().await = Some(sub_tx);

        let handle = tokio::spawn(run_reader_loop(
            agent_stdout_reader,
            pending.clone(),
            notify_tx.clone(),
            Arc::new(Mutex::new(None)),
        ));

        let payload = b"{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"stopReason\":\"end_turn\"}}\n";
        agent_stdout_writer.write_all(payload).await.unwrap();
        agent_stdout_writer.flush().await.unwrap();

        let resolved = tokio::time::timeout(std::time::Duration::from_secs(2), resp_rx)
            .await
            .expect("oneshot should resolve")
            .expect("oneshot should not be cancelled");
        assert_eq!(resolved.id, Some(7));

        let forwarded = tokio::time::timeout(std::time::Duration::from_secs(2), sub_rx.recv())
            .await
            .expect("subscriber should receive forwarded copy")
            .expect("subscriber channel should not be closed");
        assert_eq!(forwarded.id, Some(7));
        assert!(pending.lock().await.is_empty());

        drop(agent_stdout_writer);
        handle.await.unwrap();
    }

    /// Regression: the background listener must outlive the turn it was
    /// installed after. A turn that ends without `prompt_done` leaves its own
    /// (now closed) sender parked in `notify_tx`; every agent-initiated update
    /// after it — a background task reporting back, a ScheduleWakeup — used to
    /// be dropped there until the next client prompt.
    #[tokio::test]
    async fn notification_falls_back_to_idle_subscriber_when_the_turn_is_gone() {
        let (mut agent_stdout_writer, agent_stdout_reader) = duplex(8 * 1024);
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // The turn is gone: its receiver dropped with the task's stack frame.
        let (turn_tx, turn_rx) = mpsc::channel::<JsonRpcMessage>(ACP_NOTIFICATION_CAPACITY);
        drop(turn_rx);
        let notify_tx: NotificationSender = Arc::new(Mutex::new(Some(turn_tx)));

        let (idle_tx, mut idle_rx) = mpsc::channel(ACP_NOTIFICATION_CAPACITY);
        let idle_notify_tx: NotificationSender = Arc::new(Mutex::new(Some(idle_tx)));

        let handle = tokio::spawn(run_reader_loop(
            agent_stdout_reader,
            pending.clone(),
            notify_tx.clone(),
            idle_notify_tx.clone(),
        ));

        agent_stdout_writer
            .write_all(
                br#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"inner","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"background task finished"}}}}"#,
            )
            .await
            .unwrap();
        agent_stdout_writer.write_all(b"\n").await.unwrap();
        agent_stdout_writer.flush().await.unwrap();

        let forwarded = tokio::time::timeout(std::time::Duration::from_secs(2), idle_rx.recv())
            .await
            .expect("idle subscriber should receive the autonomous update")
            .expect("idle subscriber channel should not be closed");
        assert_eq!(forwarded.method.as_deref(), Some("session/update"));

        drop(agent_stdout_writer);
        handle.await.unwrap();
    }

    #[test]
    fn session_activity_touch_advances_last_active() {
        let activity = SessionActivity::new();
        // Warm the monotonic clock past zero so a backdated value is older.
        std::thread::sleep(std::time::Duration::from_millis(10));
        activity.set_last_active_ms(0);
        let before = activity.last_active_ms();
        activity.touch();
        assert!(activity.last_active_ms() > before);
        // Backdated last_active yields a positive age; touch resets it near zero.
        activity.set_last_active_ms(0);
        assert!(activity.age() >= std::time::Duration::from_millis(10));
        activity.touch();
        assert!(activity.age() < std::time::Duration::from_secs(60));
        // A future timestamp must not underflow: age saturates at zero.
        activity.set_last_active_ms(u64::MAX);
        assert_eq!(activity.age(), std::time::Duration::ZERO);
    }

    #[test]
    fn session_activity_agent_relay_age_is_none_until_the_relay_stamps_it() {
        let activity = SessionActivity::new();
        // An ordinary session that only ever served client prompts must stay
        // evictable: touch() and set_in_flight() are not relay activity.
        activity.touch();
        activity.set_in_flight(true);
        assert!(activity.agent_relay_age().is_none());
        activity.mark_agent_relay();
        assert!(activity
            .agent_relay_age()
            .is_some_and(|age| age < std::time::Duration::from_secs(60)));
    }

    #[test]
    fn session_activity_permission_wait_keeps_its_original_start() {
        let activity = SessionActivity::new();

        assert!(activity.agent_permission_wait_age().is_none());
        activity.begin_agent_permission_wait();
        let first = activity.agent_permission_wait_age();

        assert!(first.is_some());
        // A second request while one is open must not restart the clock, or a
        // chatty agent could keep a stale wait looking fresh forever.
        activity.begin_agent_permission_wait();
        assert!(activity.agent_permission_wait_age() >= first);
        activity.end_agent_permission_wait();
        assert!(activity.agent_permission_wait_age().is_none());
    }

    #[test]
    fn session_activity_set_in_flight_round_trips() {
        let activity = SessionActivity::new();
        assert!(!activity.in_flight());
        activity.set_in_flight(true);
        assert!(activity.in_flight());
        activity.set_in_flight(false);
        assert!(!activity.in_flight());
    }

    #[test]
    fn session_activity_prompt_permission_wait_round_trips() {
        let activity = SessionActivity::new();
        assert!(activity.prompt_permission_wait_age().is_none());
        activity.begin_prompt_permission_wait();
        assert!(activity.prompt_permission_wait_age().is_some());
        activity.end_prompt_permission_wait();
        assert!(activity.prompt_permission_wait_age().is_none());
        activity.begin_prompt_permission_wait();
        activity.set_in_flight(false);
        assert!(activity.prompt_permission_wait_age().is_none());
    }

    #[test]
    fn wait_phase_is_idle_by_default() {
        let activity = SessionActivity::new();
        assert_eq!(activity.wait_phase()["phase"], "idle");
    }

    #[test]
    fn wait_phase_reports_prompt_in_flight() {
        let activity = SessionActivity::new();
        activity.set_in_flight(true);
        assert_eq!(activity.wait_phase()["phase"], "prompt_in_flight");
    }

    #[test]
    fn wait_phase_reports_agent_relay_when_only_the_relay_is_active() {
        let activity = SessionActivity::new();
        activity.mark_agent_relay();
        assert_eq!(activity.wait_phase()["phase"], "agent_relay");
    }

    #[test]
    fn wait_phase_relay_branch_uses_the_pool_grace_period() {
        // `wait_phase()` gates its `agent_relay` branch through
        // `pool::relay_is_streaming`, whose own boundary behaviour (fresh
        // stamp streams, a stamp at or past the grace period does not) is
        // covered by `crates/openab-core/src/acp/pool.rs`'s
        // `relay_is_streaming_*` tests. This just pins the wiring: a fresh
        // relay stamp is still within grace, so it reports `agent_relay`
        // rather than falling back to `idle`.
        let activity = SessionActivity::new();
        activity.mark_agent_relay();
        let age = activity.agent_relay_age().expect("relay was just stamped");
        assert!(crate::acp::pool::relay_is_streaming(
            age,
            std::time::Duration::from_secs(crate::acp::pool::AGENT_RELAY_GRACE_SECS)
        ));
        assert_eq!(activity.wait_phase()["phase"], "agent_relay");
    }

    #[test]
    fn wait_phase_prefers_prompt_permission_wait_over_in_flight() {
        let activity = SessionActivity::new();
        activity.set_in_flight(true);
        activity.begin_prompt_permission_wait();
        assert_eq!(activity.wait_phase()["phase"], "prompt_permission_wait");
    }

    #[test]
    fn wait_phase_prefers_agent_permission_wait_over_agent_relay() {
        let activity = SessionActivity::new();
        activity.mark_agent_relay();
        activity.begin_agent_permission_wait();
        assert_eq!(activity.wait_phase()["phase"], "agent_permission_wait");
    }

    #[test]
    fn wait_phase_prefers_prompt_permission_wait_over_agent_permission_wait() {
        let activity = SessionActivity::new();
        activity.begin_agent_permission_wait();
        activity.begin_prompt_permission_wait();
        assert_eq!(activity.wait_phase()["phase"], "prompt_permission_wait");
    }

    #[test]
    fn wait_phase_elapsed_ms_tracks_the_open_wait() {
        let activity = SessionActivity::new();
        activity.begin_prompt_permission_wait();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let elapsed = activity.wait_phase()["phaseElapsedMs"].as_u64().unwrap();
        // A generous lower bound: CI runners can undercount a short sleep by a
        // few ms, and this only needs to prove elapsed time is tracked at all.
        assert!(elapsed >= 20, "elapsed was {elapsed}ms");
    }

    #[tokio::test]
    async fn replacing_idle_receiver_does_not_report_a_connection_failure() {
        let (mut writer, reader) = duplex(8192);
        let activity = Arc::new(super::SessionActivity::new());
        let (old_tx, mut old_rx) = mpsc::channel(ACP_NOTIFICATION_CAPACITY);
        let notify: NotificationSender = Arc::new(Mutex::new(Some(old_tx.clone())));
        let idle: NotificationSender = Arc::new(Mutex::new(Some(old_tx)));
        let handle = tokio::spawn(super::run_reader_loop_with_state(
            reader,
            Arc::new(Mutex::new(HashMap::new())),
            notify.clone(),
            idle.clone(),
            Some(activity.clone()),
        ));
        let frame = b"{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"working\"}}}}\n";
        writer.write_all(frame).await.unwrap();
        assert!(old_rx.recv().await.is_some());
        // The exact prompt_done handoff drops the old relay's final senders.
        let (next_tx, mut next_rx) = mpsc::channel(ACP_NOTIFICATION_CAPACITY);
        *idle.lock().await = Some(next_tx.clone());
        *notify.lock().await = Some(next_tx);
        assert!(old_rx.recv().await.is_none());
        assert!(!activity.connection_ended());
        writer.write_all(frame).await.unwrap();
        assert!(next_rx.recv().await.is_some());
        // A real EOF still ends the replacement relay with a failure signal.
        drop(writer);
        handle.await.unwrap();
        assert!(next_rx.recv().await.is_none());
        assert!(activity.connection_ended());
    }
}

#[cfg(test)]
async fn run_reader_loop<R: AsyncRead + Unpin + Send + 'static>(
    reader: R,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>>,
    notify_tx: NotificationSender,
    idle_notify_tx: NotificationSender,
) {
    run_reader_loop_with_state(reader, pending, notify_tx, idle_notify_tx, None).await;
}
