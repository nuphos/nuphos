use crate::acp::connection::{AcpConnection, SessionActivity};
use crate::acp::protocol::ConfigOption;
use crate::acp::session_credentials::{write_session_credentials, SESSION_CREDENTIALS_DIR_ENV};
use crate::acp::startup::{spawn_initialized, AgentCommand, LOCKED_STATE_RETRY_DELAYS};
use crate::config::AgentConfig;
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedSemaphorePermit, RwLock, Semaphore};
use tokio::time::Instant;
use tracing::{info, warn};

/// Error substrings produced by `AcpConnection::send_request` that indicate a
/// transient failure worth preserving the session ID for retry, as opposed to
/// a permanent agent-side rejection.
const TRANSIENT_LOAD_ERRORS: &[&str] = &["timeout waiting for", "channel closed"];

/// Combined state protected by a single lock to prevent deadlocks.
/// Lock ordering: never await a per-connection mutex while holding `state`.
struct PoolState {
    /// Active connections: thread_key → AcpConnection handle.
    active: HashMap<String, Arc<Mutex<AcpConnection>>>,
    /// Pool-wide capacity permits held by active sessions. A permit is acquired
    /// before spawning, then transferred here only after initialization succeeds.
    admission_permits: HashMap<String, OwnedSemaphorePermit>,
    /// Lock-free cancel handles: thread_key → (stdin, session_id).
    /// Stored separately so cancel can work without locking the connection.
    cancel_handles: HashMap<String, CancelHandle>,
    steering_handles: HashMap<String, crate::acp::steering::SteeringHandle>,
    /// Lock-free facade tokens: thread_key → the exact `OPENAB_SESSION_TOKEN` minted for the
    /// connection currently under that key. Stored here, not just inside the connection, so hung
    /// eviction can revoke the exact token **synchronously** — the `AcpConnection` DropGuard that
    /// normally revokes it cannot fire while a hung streaming task still holds an Arc of the
    /// connection, and `AcpTunnelSource` authorizes by channel alone, so an un-revoked predecessor
    /// token would keep reaching whatever tunnel a successor registers for that channel (F3).
    #[cfg(feature = "acp-mcp")]
    facade_tokens: HashMap<String, String>,
    /// Lock-free activity handles for hung-session detection without the connection mutex.
    activity: HashMap<String, Arc<SessionActivity>>,
    /// Child process-group ids, captured at insert time so hung eviction can
    /// kill the agent process without ever locking the connection.
    pgids: HashMap<String, i32>,
    /// Suspended sessions: thread_key → ACP sessionId.
    /// Used at runtime to decide which thread can be resumed via `session/load`
    /// because it no longer has a live in-memory connection.
    suspended: HashMap<String, String>,
    /// Persisted resumable sessions: thread_key → ACP sessionId.
    /// Includes both suspended sessions and active sessions so a process restart
    /// can recover any live thread via `session/load`.
    persisted: HashMap<String, String>,
    /// Serializes create/resume work per thread so rapid same-thread requests
    /// cannot race each other into duplicate `session/load` attempts.
    creating: HashMap<String, Arc<Mutex<()>>>,
    /// Per-session working directory overrides (from control directives).
    /// thread_key → canonical workspace path.
    session_workdirs: HashMap<String, String>,
    /// Client-declared http-type MCP servers per session (ACP passthrough).
    /// Kept here so an evicted-then-recreated session re-declares the same
    /// servers on its next spawn.
    session_mcp_servers: HashMap<String, Vec<serde_json::Value>>,
    /// Client-supplied session `_meta` per session (ACP passthrough), kept for
    /// the same reason as `session_mcp_servers`.
    session_meta: HashMap<String, serde_json::Value>,
}

pub struct SessionPool {
    state: RwLock<PoolState>,
    config: AgentConfig,
    max_sessions: usize,
    /// Bounds active plus initializing sessions. Per-thread `creating` gates
    /// prevent duplicate work for one key; this semaphore covers different keys.
    admission: Arc<Semaphore>,
    /// Force-evict sessions with no prompt activity longer than this threshold
    /// (`prompt_hard_timeout_secs + hung_grace_secs`, wired in main.rs).
    hung_threshold_secs: u64,
    mapping_path: PathBuf,
    meta_path: PathBuf,
    credentials_root: PathBuf,
    default_config_options: HashMap<String, String>,
    #[cfg(feature = "acp-mcp")]
    session_registrar: Option<Arc<dyn crate::acp_mcp::SessionTokenRegistrar>>,
    #[cfg(feature = "acp-mcp")]
    facade_url: Option<String>,
}

type CancelHandle = (Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>, String);
type ActiveSnapshot = Vec<(String, Arc<Mutex<AcpConnection>>)>;
/// Active connections paired with their lock-free activity handles, as read by
/// the pool-full eviction scan. A handle is `None` only for an entry torn down
/// between the two map reads.
type ActiveWithActivity = Vec<(
    String,
    Arc<Mutex<AcpConnection>>,
    Option<Arc<SessionActivity>>,
)>;
type EvictionCandidate = (String, Arc<Mutex<AcpConnection>>, Instant, Option<String>);

fn remove_if_same_handle<T>(
    map: &mut HashMap<String, Arc<Mutex<T>>>,
    key: &str,
    expected: &Arc<Mutex<T>>,
) -> Option<Arc<Mutex<T>>> {
    let should_remove = map
        .get(key)
        .is_some_and(|current| Arc::ptr_eq(current, expected));
    if should_remove {
        map.remove(key)
    } else {
        None
    }
}

fn get_or_insert_gate(map: &mut HashMap<String, Arc<Mutex<()>>>, key: &str) -> Arc<Mutex<()>> {
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Returns true when a session must be skipped by the pool-full eviction scan
/// because it still has a turn in flight.
///
/// A missing activity handle means the session predates the handle map or was
/// already torn down; treat it as evictable, matching the pre-existing behaviour
/// for entries the scan cannot inspect.
fn candidate_in_flight(activity: Option<&SessionActivity>) -> bool {
    activity.is_some_and(|a| a.in_flight())
}

/// Returns true when a session should be treated as stale during idle cleanup.
fn classify_idle(last_active: Instant, alive: bool, cutoff: Instant) -> bool {
    last_active < cutoff || !alive
}

/// Returns true when a locked, in-flight session has exceeded the hung threshold.
fn classify_hung(
    in_flight: bool,
    last_active_age: std::time::Duration,
    threshold: std::time::Duration,
    permission_wait_age: Option<std::time::Duration>,
) -> bool {
    in_flight
        && last_active_age > threshold
        && permission_wait_age.is_none_or(|age| age > threshold)
}

/// Emit the force-evict warning with **both** ids redacted.
///
/// `key` is a pool key `<platform>:<channel_id>` (`acp_<uuid>`) and `session_id` is `sess_<uuid>`;
/// either resumes the session, so both are credentials. Extracted from the loop in `cleanup_idle`
/// so the redaction can be exercised by a test for real — R1 redacted the sites it enumerated and
/// this force-evict site was outside that list, logging both ids raw.
fn warn_force_evicting_hung(
    key: &str,
    session_id: Option<&str>,
    age_secs: u64,
    threshold_secs: u64,
) {
    warn!(
        thread_id = %crate::redact::redact_session_ids(key),
        session_id = %session_id.map(crate::redact::redact_session_ids).unwrap_or_default(),
        age_secs,
        threshold_secs,
        "force-evicting hung session"
    );
}

/// Seconds of lock-free silence after which a session is no longer treated as
/// relaying an agent-initiated turn.
///
/// An agent-initiated turn (a scheduled wakeup, a post-turn write-back) streams
/// through the idle subscriber installed by `prompt_done`. Nobody holds the
/// connection mutex while it does, `prompt_in_flight` is false (it is cleared by
/// `prompt_done` itself, and `cleanup_idle` re-clears it whenever the mutex is
/// free), and `last_active` only advances on client prompts — so such a session
/// sorts as the *oldest* and is the first thing the eviction scan picks. The
/// relay stamps `SessionActivity::mark_agent_relay` for every update it
/// forwards, which is the only honest signal available without the mutex.
pub(crate) const AGENT_RELAY_GRACE_SECS: u64 = 120;

/// True while the relay stamp is fresh enough that an agent-initiated turn is
/// still streaming through the idle subscriber.
///
/// Shared with `SessionActivity::wait_phase()`, which must apply the same
/// grace period so a session doesn't report `agent_relay` forever after its
/// last forwarded update.
pub(crate) fn relay_is_streaming(relay_age: std::time::Duration, grace: std::time::Duration) -> bool {
    relay_age < grace
}

/// Returns true when a session must be skipped by the pool-full eviction scan
/// because its agent-initiated relay is still forwarding updates.
fn candidate_relaying(activity: Option<&SessionActivity>, grace: std::time::Duration) -> bool {
    activity.is_some_and(|a| {
        a.agent_relay_age()
            .is_some_and(|age| relay_is_streaming(age, grace))
    })
}

/// Returns true when a session must be skipped because its agent-initiated
/// relay is parked on a permission decision.
///
/// Bounded by the same threshold `cleanup_idle` uses for hung sessions: a
/// decision nobody ever makes must not pin a pool slot forever, and that path
/// cannot reclaim this one (the relay holds no mutex and sets no in-flight
/// flag, so `classify_hung` never sees it).
fn candidate_awaiting_permission(
    activity: Option<&SessionActivity>,
    hung_threshold: std::time::Duration,
) -> bool {
    activity.is_some_and(|a| {
        a.agent_permission_wait_age()
            .is_some_and(|age| age < hung_threshold)
    })
}

/// Returns true when `candidate_last_active` is a better eviction target than `current_oldest`.
fn better_candidate(current_oldest: Option<Instant>, candidate_last_active: Instant) -> bool {
    match current_oldest {
        Some(oldest) => candidate_last_active < oldest,
        None => true,
    }
}

/// Prepare facade browser capabilities for one session: write the agent's facade MCP entry, and
/// mint its session token **only if that write succeeded**.
///
/// The token is useless without the config. The file carries
/// `Authorization: Bearer ${OPENAB_SESSION_TOKEN}`, and it is the artifact the OPERATOR wires in
/// — since D-15 openab writes only `.openab/mcp-facade.json`, which no agent reads on its own, so
/// the import or `--mcp-config` flag is what actually points the agent at the facade. The ordering
/// still holds for a narrower reason: if openab cannot even author that file, the session has no
/// path to the facade it could be wired to, and minting regardless would register a live
/// credential for a session that cannot use it and leave it valid until eviction, while the
/// failure showed up only as a warning. Returning `None` keeps the session running without
/// browser capabilities, which is the honest description of what actually happened.
#[cfg(feature = "acp-mcp")]
async fn setup_facade_session(
    workdir: &str,
    facade_url: &str,
    channel_id: &str,
    registrar: &Arc<dyn crate::acp_mcp::SessionTokenRegistrar>,
) -> Option<String> {
    match crate::acp_mcp::write_facade_mcp_config(workdir, facade_url).await {
        Ok(()) => Some(registrar.mint(channel_id)),
        Err(e) => {
            tracing::error!(
                workdir, error = %e,
                "facade mcp config write failed — starting this session WITHOUT browser \
                 capabilities and not minting a session token that could never be presented"
            );
            None
        }
    }
}

/// Remove every non-`active` pool entry for `key`.
///
/// The single implementation for both hung eviction and [`SessionPool::reset_session`]; the latter
/// removes `active` itself and then calls this. It used to be a second copy of the same list, which
/// is how the two could drift — and the line most likely to be lost from a copy is the one below
/// about the creating gate, because it says *not* to remove something.
///
/// Hung eviction must NOT leave the session resumable: the old streaming task still holds an Arc
/// clone of the connection, so the agent process may be alive and mid-turn. If the session id
/// stayed in `suspended`/`persisted`, the next message would `session/load` the same session while
/// the old process still owns an in-flight turn.
fn purge_session_entries(state: &mut PoolState, key: &str) {
    state.admission_permits.remove(key);
    state.cancel_handles.remove(key);
    state.steering_handles.remove(key);
    state.activity.remove(key);
    state.pgids.remove(key);
    state.suspended.remove(key);
    state.persisted.remove(key);
    // Do NOT remove the creating gate: it is concurrency control, not session
    // state. Removing it while a holder still owns the old gate Arc would let
    // a concurrent get_or_create mint a fresh gate and run two creations for
    // the same key.
    state.session_workdirs.remove(key);
    state.session_mcp_servers.remove(key);
    state.session_meta.remove(key);
}

/// Escalating kill for a hung agent's process group: wait 10s after the
/// session/cancel attempt, SIGTERM, wait 2s, SIGKILL. Mirrors
/// `AcpConnection::kill_process_group`, which cannot run here because the
/// hung task never drops its connection Arc.
async fn kill_pgid_after_grace(pgid: Option<i32>) {
    let Some(pgid) = pgid.filter(|p| *p > 0) else {
        return;
    };
    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(-pgid, libc::SIGTERM);
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    {
        // No process-group kill on non-unix; rely on AcpConnection::Drop's
        // Windows handling if/when the hung task eventually unwinds.
        let _ = pgid;
    }
}

/// Remove a hung session from all pool maps. Returns true if the exact
/// connection captured at classification time was still registered; when a
/// fresh replacement exists for the key, nothing is touched.
fn apply_hung_eviction(
    state: &mut PoolState,
    key: &str,
    expected: &Arc<Mutex<AcpConnection>>,
) -> bool {
    if remove_if_same_handle(&mut state.active, key, expected).is_none() {
        return false;
    }
    purge_session_entries(state, key);
    true
}

/// Record `token` as the facade token for `key`, revoking whatever token it supersedes.
///
/// A superseded token belongs to a predecessor connection under the same key. Its `AcpConnection`
/// DropGuard normally revokes it, but if that predecessor is hung (a stuck streaming task still
/// holds an Arc) the guard never fires — so revoking the superseded token here is what stops it
/// staying valid for the channel after a successor takes over (F3). Revocation is by exact token
/// and idempotent, so overlapping with the guard on a clean replacement is harmless.
#[cfg(feature = "acp-mcp")]
fn install_facade_token(
    state: &mut PoolState,
    key: &str,
    token: String,
    registrar: Option<&Arc<dyn crate::acp_mcp::SessionTokenRegistrar>>,
) {
    if let Some(superseded) = state.facade_tokens.insert(key.to_string(), token) {
        if let Some(registrar) = registrar {
            registrar.revoke(&superseded);
        }
    }
}

/// Revoke and forget the facade token recorded for `key`, if any.
///
/// Called from every path that removes a connection from `active` (hung eviction, idle eviction,
/// reset, suspend). On the clean paths the connection also drops and its guard revokes the same
/// token — idempotent — but the hung path is the one that needs this: the guard cannot fire while
/// the hung task holds an Arc, so without a synchronous revoke here the token outlives the eviction
/// and `AcpTunnelSource` (channel-only authorization) would let the hung predecessor reach a
/// successor's tunnel (F3). `purge_session_entries` deliberately does NOT touch `facade_tokens`, so
/// this can run *after* `apply_hung_eviction` and still find the token to revoke.
#[cfg(feature = "acp-mcp")]
fn revoke_facade_token_for_key(
    state: &mut PoolState,
    key: &str,
    registrar: Option<&Arc<dyn crate::acp_mcp::SessionTokenRegistrar>>,
) {
    if let Some(token) = state.facade_tokens.remove(key) {
        if let Some(registrar) = registrar {
            registrar.revoke(&token);
        }
    }
}

/// Write a `session/cancel` notification straight to the agent's stdin.
///
/// Uses the lock-free cancel handle rather than the connection mutex, so it works
/// even while a turn is streaming (which holds that mutex).
async fn send_session_cancel(
    stdin: &Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
    session_id: &str,
) -> Result<()> {
    let data = serde_json::to_string(&serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/cancel",
        "params": {"sessionId": session_id}
    }))?;
    use tokio::io::AsyncWriteExt;
    let mut w = stdin.lock().await;
    w.write_all(data.as_bytes()).await?;
    w.write_all(b"\n").await?;
    w.flush().await?;
    Ok(())
}

impl SessionPool {
    /// Read without taking the per-session mutex held throughout a prompt.
    /// This neither loads a session nor claims its output/permission routes.
    pub async fn execution_session_keys(&self) -> Vec<String> {
        let state = self.state.read().await;
        let mut keys: Vec<_> = state
            .activity
            .keys()
            .chain(state.creating.keys())
            .cloned()
            .collect();
        keys.sort();
        keys.dedup();
        keys
    }

    pub async fn steer_session(
        &self,
        thread_id: &str,
        prompt: serde_json::Value,
    ) -> Result<serde_json::Value, (i32, String)> {
        let handle = self
            .state
            .read()
            .await
            .steering_handles
            .get(thread_id)
            .cloned()
            .ok_or_else(|| {
                (
                    -32004,
                    "This session does not support native steering".into(),
                )
            })?;
        handle.steer(prompt).await
    }

    pub async fn execution_snapshot(&self, thread_id: &str) -> serde_json::Value {
        let state = self.state.read().await;
        let loading = state
            .creating
            .get(thread_id)
            .is_some_and(|gate| gate.try_lock().is_err());
        match state.activity.get(thread_id) {
            Some(activity) => {
                let mut snapshot = activity.execution.snapshot();
                snapshot["steeringSupported"] =
                    serde_json::json!(state.steering_handles.contains_key(thread_id));
                snapshot["activityPhase"] = activity.wait_phase();
                if loading && !activity.in_flight() {
                    snapshot["operation"] = serde_json::json!("loading");
                }
                snapshot
            }
            None if loading => serde_json::json!({"state": "unknown", "operation": "loading"}),
            None => serde_json::json!({"state": "dormant"}),
        }
    }

    pub fn new(
        config: AgentConfig,
        max_sessions: usize,
        hung_threshold_secs: u64,
        default_config_options: HashMap<String, String>,
    ) -> Self {
        let openab_dir = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
            .join(".openab");
        let _ = std::fs::create_dir_all(&openab_dir);
        let mapping_path = openab_dir.join("thread_map.json");
        let meta_path = openab_dir.join("session_meta.json");
        let credentials_root = openab_dir.join("credentials");
        let suspended = Self::load_mapping(&mapping_path);
        let session_workdirs = Self::load_mapping(&meta_path);
        Self {
            state: RwLock::new(PoolState {
                active: HashMap::new(),
                admission_permits: HashMap::new(),
                cancel_handles: HashMap::new(),
                steering_handles: HashMap::new(),
                #[cfg(feature = "acp-mcp")]
                facade_tokens: HashMap::new(),
                activity: HashMap::new(),
                pgids: HashMap::new(),
                persisted: suspended.clone(),
                suspended,
                creating: HashMap::new(),
                session_workdirs,
                session_mcp_servers: HashMap::new(),
                session_meta: HashMap::new(),
            }),
            config,
            max_sessions,
            admission: Arc::new(Semaphore::new(max_sessions)),
            hung_threshold_secs,
            mapping_path,
            meta_path,
            credentials_root,
            default_config_options,
            #[cfg(feature = "acp-mcp")]
            session_registrar: None,
            #[cfg(feature = "acp-mcp")]
            facade_url: None,
        }
    }

    /// Wire the facade session-token registrar + facade URL, set by the root
    /// when `[mcp]` is running. With both present the pool does its half: mints
    /// one token per session, injects it as `OPENAB_SESSION_TOKEN` in the agent
    /// process env, and writes the static facade MCP entry once per workdir.
    ///
    /// That is necessary but NOT sufficient for browser capabilities to route
    /// through the facade. The operator must still put the written entry in front
    /// of the agent, and a `type:acp` server must actually attach over `/acp` —
    /// admission is that transport auth, not a config allowlist (D-29 removed
    /// `[[mcp.acp_servers]]`, reversing D-20).
    #[cfg(feature = "acp-mcp")]
    pub fn with_facade_sessions(
        mut self,
        registrar: Option<Arc<dyn crate::acp_mcp::SessionTokenRegistrar>>,
        facade_url: Option<String>,
    ) -> Self {
        self.session_registrar = registrar;
        self.facade_url = facade_url;
        self
    }

    fn load_mapping(path: &Path) -> HashMap<String, String> {
        match std::fs::read_to_string(path) {
            Ok(data) => serde_json::from_str(&data).unwrap_or_else(|e| {
                warn!(path = %path.display(), error = %e, "corrupt mapping file, starting fresh");
                HashMap::new()
            }),
            Err(_) => HashMap::new(),
        }
    }

    fn save_mapping(&self, persisted: &HashMap<String, String>) {
        let data = match serde_json::to_string_pretty(persisted) {
            Ok(d) => d,
            Err(e) => {
                warn!(error = %e, "failed to serialize thread mapping");
                return;
            }
        };
        let tmp = self.mapping_path.with_extension("json.tmp");
        if let Err(e) =
            std::fs::write(&tmp, &data).and_then(|_| std::fs::rename(&tmp, &self.mapping_path))
        {
            warn!(path = %self.mapping_path.display(), error = %e, "failed to persist thread mapping");
        }
    }

    fn save_meta(&self, workdirs: &HashMap<String, String>) {
        let data = match serde_json::to_string_pretty(workdirs) {
            Ok(d) => d,
            Err(e) => {
                warn!(error = %e, "failed to serialize session metadata");
                return;
            }
        };
        let tmp = self.meta_path.with_extension("json.tmp");
        if let Err(e) =
            std::fs::write(&tmp, &data).and_then(|_| std::fs::rename(&tmp, &self.meta_path))
        {
            warn!(path = %self.meta_path.display(), error = %e, "failed to persist session metadata");
        }
    }

    /// Reserve one pool slot before any ACP process is spawned.
    ///
    /// A dead connection being rebuilt keeps its existing slot. Otherwise a
    /// full pool may suspend the oldest idle connection to make room. The
    /// returned permit remains local while initialization is in flight, so a
    /// failed or cancelled creation releases capacity automatically.
    async fn reserve_admission(
        &self,
        thread_id: &str,
        eviction_candidate: Option<EvictionCandidate>,
        skipped_locked_candidates: usize,
    ) -> Result<OwnedSemaphorePermit> {
        let mut state = self.state.write().await;

        // Rebuilding a dead connection consumes the same logical slot. Move
        // its permit out of the active map and hold it across initialization.
        if let Some(permit) = state.admission_permits.remove(thread_id) {
            return Ok(permit);
        }

        if let Ok(permit) = Arc::clone(&self.admission).try_acquire_owned() {
            return Ok(permit);
        }

        if let Some((key, expected_conn, _, sid)) = eviction_candidate {
            // The candidate was idle when scanned, but it may have started a
            // turn since then. Never evict a connection that is busy now.
            let Ok(_idle_guard) = expected_conn.try_lock() else {
                warn!(
                    max_sessions = self.max_sessions,
                    "pool full but the idle eviction candidate became busy"
                );
                return Err(anyhow!("pool exhausted ({} sessions)", self.max_sessions));
            };

            let activity = state.activity.get(&key).map(Arc::as_ref);
            if candidate_in_flight(activity)
                || candidate_relaying(
                    activity,
                    std::time::Duration::from_secs(AGENT_RELAY_GRACE_SECS),
                )
                || candidate_awaiting_permission(
                    activity,
                    std::time::Duration::from_secs(self.hung_threshold_secs),
                )
            {
                return Err(anyhow!("pool exhausted ({} sessions)", self.max_sessions));
            }
            if remove_if_same_handle(&mut state.active, &key, &expected_conn).is_some() {
                state.admission_permits.remove(&key);
                state.cancel_handles.remove(&key);
                state.steering_handles.remove(&key);
                state.activity.remove(&key);
                state.pgids.remove(&key);
                #[cfg(feature = "acp-mcp")]
                revoke_facade_token_for_key(&mut state, &key, self.session_registrar.as_ref());
                info!(evicted = %crate::redact::redact_session_ids(&key), "pool full, suspending oldest idle session before replacement spawn");
                if let Some(sid) = sid {
                    state.persisted.insert(key.clone(), sid.clone());
                    state.suspended.insert(key, sid);
                } else {
                    state.persisted.remove(&key);
                }
                self.save_mapping(&state.persisted);
            } else {
                warn!(evicted = %crate::redact::redact_session_ids(&key), "pool full but eviction candidate changed before removal");
            }
        } else if skipped_locked_candidates > 0 {
            warn!(
                max_sessions = self.max_sessions,
                skipped_locked_candidates,
                "pool full but all other sessions were busy during eviction scan"
            );
        }

        Arc::clone(&self.admission)
            .try_acquire_owned()
            .map_err(|_| anyhow!("pool exhausted ({} sessions)", self.max_sessions))
    }

    /// Check if session state exists for this thread (active, suspended, or persisted).
    #[allow(dead_code)]
    pub async fn has_active_session(&self, thread_id: &str) -> bool {
        let state = self.state.read().await;
        // Any of these means the thread already has session state.
        if state.suspended.contains_key(thread_id) || state.persisted.contains_key(thread_id) {
            return true;
        }
        if let Some(conn) = state.active.get(thread_id) {
            match conn.try_lock() {
                Ok(c) => return c.alive(),
                Err(_) => return true, // lock held = connection busy streaming = alive
            }
        }
        false
    }

    pub async fn get_or_create(
        &self,
        thread_id: &str,
        working_dir_override: Option<&str>,
        mcp_servers: &[serde_json::Value],
        session_meta: Option<&serde_json::Value>,
    ) -> Result<bool> {
        self.get_or_restore(
            thread_id,
            working_dir_override,
            mcp_servers,
            session_meta,
            false,
        )
        .await
    }

    /// Restore only a known native session, without a prompt or output attachment.
    pub async fn restore_for_config(
        &self,
        thread_id: &str,
        cwd: &str,
        mcp_servers: &[serde_json::Value],
        meta: Option<&serde_json::Value>,
    ) -> Result<()> {
        self.get_or_restore(thread_id, Some(cwd), mcp_servers, meta, true)
            .await?;
        Ok(())
    }

    async fn get_or_restore(
        &self,
        thread_id: &str,
        working_dir_override: Option<&str>,
        mcp_servers: &[serde_json::Value],
        session_meta: Option<&serde_json::Value>,
        restore_only: bool,
    ) -> Result<bool> {
        let create_gate = {
            let mut state = self.state.write().await;
            if restore_only
                && !state.persisted.contains_key(thread_id)
                && !state.active.contains_key(thread_id)
            {
                return Err(anyhow!("No saved native session to restore"));
            }
            // A non-empty declaration updates the stored set even when a live
            // session short-circuits below: it takes effect on the next spawn,
            // never restarting a live session.
            if !restore_only
                && !mcp_servers.is_empty()
                && state.session_mcp_servers.get(thread_id).map(Vec::as_slice) != Some(mcp_servers)
            {
                state
                    .session_mcp_servers
                    .insert(thread_id.to_string(), mcp_servers.to_vec());
            }
            if let Some(meta) = session_meta.filter(|_| !restore_only) {
                if state.session_meta.get(thread_id) != Some(meta) {
                    state
                        .session_meta
                        .insert(thread_id.to_string(), meta.clone());
                }
            }
            get_or_insert_gate(&mut state.creating, thread_id)
        };
        // A live agent keeps its spawn-time env; credentials reach it through
        // these files, refreshed on every prompt.
        write_session_credentials(&self.credentials_root, thread_id, session_meta);
        let _create_guard = create_gate.lock().await;

        let (existing, saved_session_id) = {
            let state = self.state.read().await;
            (
                state.active.get(thread_id).cloned(),
                state.suspended.get(thread_id).cloned(),
            )
        };

        let had_existing = existing.is_some();
        let mut saved_session_id = saved_session_id;
        if let Some(conn) = existing.clone() {
            // Never await the existing connection's mutex here: we hold the
            // per-thread creating gate, so blocking on a hung connection would
            // permanently jam ALL future messages for this thread_id (F1).
            // Lock held = busy streaming = alive (same convention as
            // has_active_session); cleanup_idle owns hung recovery.
            let Ok(conn) = conn.try_lock() else {
                return Ok(false);
            };
            if conn.alive() {
                return Ok(false);
            }
            if saved_session_id.is_none() {
                saved_session_id = conn.acp_session_id.clone();
            }
        }

        if restore_only {
            if saved_session_id.is_none() {
                return Err(anyhow!("No saved native session to restore"));
            }
            let mut state = self.state.write().await;
            state
                .session_mcp_servers
                .insert(thread_id.to_string(), mcp_servers.to_vec());
            if let Some(meta) = session_meta {
                state
                    .session_meta
                    .insert(thread_id.to_string(), meta.clone());
            }
        }

        // Snapshot active handles so we can inspect them outside the state lock.
        // The activity handle comes along because a session can be mid-turn while
        // its connection mutex is free: a turn parked on an out-of-band reply (for
        // example `session/request_permission`) holds no lock and emits no ACP
        // traffic, so `try_lock` and `last_active` both make it look like the
        // oldest idle session.
        let snapshot: ActiveWithActivity = {
            let state = self.state.read().await;
            state
                .active
                .iter()
                .map(|(k, v)| (k.clone(), Arc::clone(v), state.activity.get(k).cloned()))
                .collect()
        };

        let relay_grace = std::time::Duration::from_secs(AGENT_RELAY_GRACE_SECS);
        let hung_threshold = std::time::Duration::from_secs(self.hung_threshold_secs);
        let mut eviction_candidate: Option<EvictionCandidate> = None;
        let mut skipped_locked_candidates = 0usize;
        let mut skipped_in_flight_candidates = 0usize;
        let mut skipped_relaying_candidates = 0usize;
        let mut skipped_permission_candidates = 0usize;
        for (key, conn, activity) in snapshot {
            if key == thread_id {
                continue;
            }
            // Never suspend a session whose agent-initiated turn is mid-relay.
            // That turn carries no client request id, so nothing downstream can
            // tell it apart from a turn that simply never ends: killing the agent
            // strands the consumer on a stream that stops without a terminal
            // update. `in_flight` does not cover this — it is false for the whole
            // relay — so the relay stamp is checked on its own.
            if candidate_relaying(activity.as_deref(), relay_grace) {
                skipped_relaying_candidates += 1;
                continue;
            }
            // The relay stamp ages out while a human is deciding; the wait
            // itself is what says the turn is still alive.
            if candidate_awaiting_permission(activity.as_deref(), hung_threshold) {
                skipped_permission_candidates += 1;
                continue;
            }
            // Never suspend a session that still has a turn in flight. Doing so
            // kills the agent process mid-turn: every pending tool call fails with
            // "Tool use aborted", the client's replies are dropped as belonging to
            // a superseded turn, and the turn ends without a stop reason, so the
            // conversation appears stuck forever. Genuinely hung turns are still
            // reclaimed by `cleanup_idle` via `classify_hung`.
            if candidate_in_flight(activity.as_deref()) {
                skipped_in_flight_candidates += 1;
                continue;
            }
            let conn_handle = Arc::clone(&conn);
            let Ok(conn) = conn.try_lock() else {
                skipped_locked_candidates += 1;
                continue;
            };
            let candidate = (
                key,
                conn_handle,
                conn.last_active,
                conn.acp_session_id.clone(),
            );
            if better_candidate(
                eviction_candidate.as_ref().map(|(_, _, t, _)| *t),
                candidate.2,
            ) {
                eviction_candidate = Some(candidate);
            }
        }

        let admission_permit = self
            .reserve_admission(
                thread_id,
                eviction_candidate,
                skipped_locked_candidates
                    + skipped_in_flight_candidates
                    + skipped_relaying_candidates
                    + skipped_permission_candidates,
            )
            .await?;

        // Resolve effective working directory: stored per-session > explicit override > global config.
        // Stored value has highest priority to enforce immutability (ADR §4.5).
        let (stored_workdir, session_mcp_servers, session_meta) = {
            let state = self.state.read().await;
            (
                state.session_workdirs.get(thread_id).cloned(),
                state
                    .session_mcp_servers
                    .get(thread_id)
                    .cloned()
                    .unwrap_or_default(),
                state.session_meta.get(thread_id).cloned(),
            )
        };

        let effective_workdir = if let Some(stored) = stored_workdir {
            stored
        } else if let Some(wd) = working_dir_override {
            wd.to_string()
        } else {
            self.config.working_dir.clone()
        };

        // Browser capabilities for an `acp:` session come from the OAB MCP Facade and nowhere
        // else: mint a per-session token (it rides the agent spawn below as OPENAB_SESSION_TOKEN)
        // and write the static facade entry before the agent boots. The returned guard revokes
        // that token when this connection is dropped, on any evict path.
        //
        // There is no transport fallback. Without `[mcp]` the root wires no registrar, and the
        // session simply starts without browser capabilities — which is the honest outcome and is
        // reported once at startup rather than being silently substituted per session.
        #[cfg(feature = "acp-mcp")]
        let mut session_token: Option<String> = None;
        #[cfg(feature = "acp-mcp")]
        let facade_token_guard: Option<tokio_util::sync::DropGuard> = match (
            thread_id.strip_prefix("acp:"),
            self.session_registrar.as_ref(),
            self.facade_url.as_ref(),
        ) {
            (Some(channel_id), Some(registrar), Some(facade_url)) => {
                match setup_facade_session(&effective_workdir, facade_url, channel_id, registrar)
                    .await
                {
                    Some(token) => {
                        session_token = Some(token.clone());
                        info!(thread_id = %crate::redact::redact_session_ids(thread_id), "session token minted for facade browser capabilities");
                        // The guard carries the TOKEN it minted, not the channel. A replaced
                        // session's teardown runs after its successor has already re-minted for
                        // the same channel, so revoking by channel would strip the live token and
                        // silently cut the new agent off from the facade; revoking this exact
                        // token is a no-op by then (R1).
                        let ct = tokio_util::sync::CancellationToken::new();
                        let child = ct.child_token();
                        let registrar = registrar.clone();
                        tokio::spawn(async move {
                            child.cancelled().await;
                            registrar.revoke(&token);
                        });
                        Some(ct.drop_guard())
                    }
                    // No config, so no token and no revoke guard to arm. The session still
                    // starts — it simply has no browser capabilities.
                    None => None,
                }
            }
            _ => None,
        };

        // Build the replacement connection outside the state lock so one stuck
        // initialization does not block all unrelated sessions.
        let mut base_env = self.config.env.clone();
        if let Some(dir) =
            write_session_credentials(&self.credentials_root, thread_id, session_meta.as_ref())
        {
            base_env.insert(
                SESSION_CREDENTIALS_DIR_ENV.to_string(),
                dir.to_string_lossy().into_owned(),
            );
        }
        #[cfg(feature = "acp-mcp")]
        let spawn_env: std::collections::HashMap<String, String> = {
            let mut env = base_env;
            if let Some(tok) = &session_token {
                // The static facade MCP entry references ${OPENAB_SESSION_TOKEN};
                // the value lives only in this agent process's environment.
                env.insert("OPENAB_SESSION_TOKEN".to_string(), tok.clone());
            }
            env
        };
        #[cfg(not(feature = "acp-mcp"))]
        let spawn_env = base_env;
        // Callers may pass a per-session working directory that doesn't exist
        // yet (e.g. per-conversation isolation). Create it so the spawn's
        // current_dir() doesn't fail.
        let _ = std::fs::create_dir_all(&effective_workdir);
        let mut new_conn = spawn_initialized(
            &AgentCommand {
                command: &self.config.command,
                args: &self.config.args,
                working_dir: &effective_workdir,
                env: &spawn_env,
                inherit_env: &self.config.inherit_env,
            },
            &LOCKED_STATE_RETRY_DELAYS,
        )
        .await?;

        let mut resumed = false;
        let mut load_failed: Option<&str> = None;
        if let Some(ref sid) = saved_session_id {
            if new_conn.supports_load_session {
                match new_conn
                    .session_load(
                        sid,
                        &effective_workdir,
                        &session_mcp_servers,
                        session_meta.as_ref(),
                    )
                    .await
                {
                    Ok(()) => {
                        info!(thread_id = %crate::redact::redact_session_ids(thread_id), session_id = %crate::redact::redact_session_ids(sid), "session resumed via session/load");
                        resumed = true;
                    }
                    Err(e) => {
                        if restore_only {
                            return Err(e.context("Could not restore the saved native session"));
                        }
                        let err_str = e.to_string();
                        let is_transient =
                            TRANSIENT_LOAD_ERRORS.iter().any(|s| err_str.contains(s));
                        if is_transient {
                            warn!(thread_id = %crate::redact::redact_session_ids(thread_id), session_id = %crate::redact::redact_session_ids(sid), error = %e,
                                "session/load failed transiently, preserving session ID for retry");
                            load_failed = Some(if err_str.contains("timeout waiting for") {
                                "timeout"
                            } else {
                                "connection lost"
                            });
                        } else {
                            warn!(thread_id = %crate::redact::redact_session_ids(thread_id), session_id = %crate::redact::redact_session_ids(sid), error = %e,
                                "session/load failed, creating new session");
                        }
                    }
                }
            }
        }

        if let Some(reason) = load_failed {
            // session/load failed transiently. The original session ID is already
            // in state.persisted (we haven't touched it), so the next message will
            // retry session/load automatically. Return an error so the current message
            // is not processed against a context-free session.
            return Err(anyhow!(
                "session load {reason}: could not restore previous session"
            ));
        }

        if !resumed {
            if restore_only {
                return Err(anyhow!(
                    "Agent does not support restoring the saved session"
                ));
            }
            new_conn
                .session_new(
                    &effective_workdir,
                    &session_mcp_servers,
                    session_meta.as_ref(),
                )
                .await?;

            // Surface the reset banner both for restored sessions and for stale
            // live entries that died before we could recover a resumable
            // session id. In both cases the caller is continuing after an
            // unexpected session loss.
            if had_existing || saved_session_id.is_some() {
                new_conn.session_reset = true;
            }
        }

        // default_config_options are process-level, so they must be reapplied
        // on every spawn, including a resumed session/load.
        for (config_id, value) in &self.default_config_options {
            if let Err(e) = new_conn.set_config_option(config_id, value).await {
                warn!(config_id, value, error = %e, "failed to set default config option");
            }
        }

        let cancel_handle = new_conn.cancel_handle();
        let steering_handle = new_conn.steering_handle();
        let activity_handle = new_conn.activity_handle();
        let child_pgid = new_conn.child_pgid();
        let cancel_session_id = new_conn.acp_session_id.clone().unwrap_or_default();
        #[cfg(feature = "acp-mcp")]
        new_conn.set_facade_token_guard(facade_token_guard);
        let new_conn = Arc::new(Mutex::new(new_conn));

        let mut state = self.state.write().await;

        // Another task may have created a healthy connection while we were
        // initializing this one.
        if let Some(existing) = state.active.get(thread_id).cloned() {
            let Ok(existing) = existing.try_lock() else {
                return Ok(false);
            };
            if existing.alive() {
                return Ok(false);
            }
            warn!(thread_id = %crate::redact::redact_session_ids(thread_id), "stale connection, rebuilding");
            drop(existing);
            state.active.remove(thread_id);
            state.cancel_handles.remove(thread_id);
            state.steering_handles.remove(thread_id);
            state.activity.remove(thread_id);
            state.pgids.remove(thread_id);
        }

        if cancel_session_id.is_empty() {
            state.persisted.remove(thread_id);
        } else {
            state
                .persisted
                .insert(thread_id.to_string(), cancel_session_id.clone());
        }
        state.suspended.remove(thread_id);
        state
            .admission_permits
            .insert(thread_id.to_string(), admission_permit);
        state.active.insert(thread_id.to_string(), new_conn);
        if let Some(handle) = steering_handle {
            state.steering_handles.insert(thread_id.to_string(), handle);
        }
        state
            .activity
            .insert(thread_id.to_string(), activity_handle);
        if let Some(pgid) = child_pgid {
            state.pgids.insert(thread_id.to_string(), pgid);
        }
        if !cancel_session_id.is_empty() {
            state
                .cancel_handles
                .insert(thread_id.to_string(), (cancel_handle, cancel_session_id));
        }
        // Record this connection's exact token lock-free, revoking any predecessor token it
        // supersedes under the same key (its guard cannot fire if that predecessor is hung). F3.
        #[cfg(feature = "acp-mcp")]
        if let Some(token) = session_token {
            install_facade_token(
                &mut state,
                thread_id,
                token,
                self.session_registrar.as_ref(),
            );
        }
        self.save_mapping(&state.persisted);

        // Persist workspace override only after session spawn succeeded (口渡 F2).
        if working_dir_override.is_some() {
            state
                .session_workdirs
                .entry(thread_id.to_string())
                .or_insert_with(|| effective_workdir.clone());
            self.save_meta(&state.session_workdirs);
        }

        drop(state);

        // Return true only for genuinely new sessions — not resumed or reconnected ones.
        // A session with prior state (saved_session_id or had_existing) is a resume,
        // even if we had to spawn a new ACP process. ADR §2.2: directives are first-message-only.
        let is_fresh = !had_existing && saved_session_id.is_none();
        Ok(is_fresh)
    }

    /// Get mutable access to a connection. Caller must have called get_or_create first.
    ///
    /// Only the per-connection `Mutex` is held during `f`; the pool-level
    /// `RwLock` is acquired briefly (read-only) to look up the `Arc` and then
    /// released, so other connections can be used concurrently.
    pub async fn with_connection<F, R>(&self, thread_id: &str, f: F) -> Result<R>
    where
        F: for<'a> FnOnce(
            &'a mut AcpConnection,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<R>> + Send + 'a>,
        >,
    {
        let conn = {
            let state = self.state.read().await;
            state.active.get(thread_id).cloned().ok_or_else(|| {
                anyhow!(
                    "no connection for thread {}",
                    crate::redact::redact_session_ids(thread_id)
                )
            })?
        };

        let mut conn = conn.lock().await;
        f(&mut conn).await
    }

    /// Get cached configOptions for a session (e.g. available models).
    pub async fn get_config_options(&self, thread_id: &str) -> Vec<ConfigOption> {
        let state = self.state.read().await;
        let conn = match state.active.get(thread_id) {
            Some(c) => c.clone(),
            None => return Vec::new(),
        };
        drop(state);
        let conn = conn.lock().await;
        conn.config_options.clone()
    }

    /// Set a config option (e.g. model) via ACP and return updated options.
    pub async fn set_config_option(
        &self,
        thread_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<Vec<ConfigOption>> {
        let conn = {
            let state = self.state.read().await;
            state.active.get(thread_id).cloned().ok_or_else(|| {
                anyhow!(
                    "no connection for thread {}",
                    crate::redact::redact_session_ids(thread_id)
                )
            })?
        };
        let mut conn = conn.lock().await;
        conn.set_config_option(config_id, value).await
    }

    /// Control an existing inner session without attaching an output sink,
    /// starting a prompt, or changing the session's execution principal.
    pub async fn session_config_options(
        &self,
        thread_id: &str,
        selection: Option<(&str, &str)>,
    ) -> std::result::Result<serde_json::Value, (i32, String)> {
        let handle = self
            .state
            .read()
            .await
            .active
            .get(thread_id)
            .cloned()
            .ok_or_else(|| {
                (
                    -32004,
                    "Session is not running; send a message to resume it".into(),
                )
            })?;
        let mut conn = handle.try_lock().map_err(|_| {
            (
                -32005,
                "Session is responding; wait for the current turn to finish".into(),
            )
        })?;
        if !conn.alive() {
            return Err((
                -32004,
                "Session is not running; send a message to resume it".into(),
            ));
        }
        if let Some((id, value)) = selection {
            let valid = conn.config_options.iter().any(|option| {
                option.id == id && option.options.iter().any(|choice| choice.value == value)
            });
            if !valid {
                return Err((-32602, "Unknown configuration option or value".into()));
            }
            conn.set_config_option_strict(id, value)
                .await
                .map_err(|_| {
                    (
                        -32603,
                        "Agent could not confirm the configuration change".into(),
                    )
                })?;
        }
        Ok(serde_json::json!({ "configOptions": conn.config_options }))
    }

    /// Query account-level usage/billing from the backend agent for a session
    /// (kiro-cli extension). Fails when there is no active session for the
    /// thread or the backend does not support usage queries.
    pub async fn get_usage(&self, thread_id: &str) -> Result<crate::acp::protocol::UsageReport> {
        let conn = {
            let state = self.state.read().await;
            state.active.get(thread_id).cloned().ok_or_else(|| {
                anyhow!(
                    "no connection for thread {}",
                    crate::redact::redact_session_ids(thread_id)
                )
            })?
        };
        let mut conn = conn.lock().await;
        conn.get_usage().await
    }

    /// Cancel the current in-flight operation for a session.
    /// Uses pre-stored cancel handles to avoid locking the connection (which is held during streaming).
    pub async fn cancel_session(&self, thread_id: &str) -> Result<()> {
        let (stdin, session_id) = {
            let state = self.state.read().await;
            if let Some(activity) = state.activity.get(thread_id) {
                if activity.in_flight() || activity.execution.snapshot()["state"] == "active" {
                    activity.execution.operation("cancelling");
                }
            }
            state
                .cancel_handles
                .get(thread_id)
                .cloned()
                .ok_or_else(|| {
                    anyhow!(
                        "no session for thread {}",
                        crate::redact::redact_session_ids(thread_id)
                    )
                })?
        };
        tracing::info!(session_id = %crate::redact::redact_session_ids(&session_id), "sending session/cancel");
        send_session_cancel(&stdin, &session_id).await
    }

    /// Reset a session: cancel any in-flight operation, remove the active connection,
    /// and clear all suspended state. The ACP process will be killed once the last
    /// Arc reference is dropped (after streaming finishes). The next message will
    /// trigger a fresh `get_or_create` with a new ACP session.
    pub async fn reset_session(&self, thread_id: &str) -> Result<()> {
        // Send session/cancel via the lock-free stdin handle first.
        // This stops in-flight streaming even while with_connection() holds the
        // connection mutex, so the old process finishes promptly.
        if let Some((stdin, session_id)) = {
            let state = self.state.read().await;
            state.cancel_handles.get(thread_id).cloned()
        } {
            tracing::info!(session_id = %crate::redact::redact_session_ids(&session_id), "reset: sending session/cancel");
            // Best-effort: a reset proceeds even if the agent's stdin is already gone.
            let _ = send_session_cancel(&stdin, &session_id).await;
        }

        let mut state = self.state.write().await;
        let had_active = state.active.remove(thread_id).is_some();
        // Everything else a reset clears is exactly what hung eviction clears, including the rule
        // that the creating gate survives. Call the one implementation rather than keeping a second
        // copy of the list: the copies are what let the two drift, and the gate rule is precisely
        // the kind of line that gets dropped from a duplicate without anyone noticing.
        purge_session_entries(&mut state, thread_id);
        // Resetting a hung session drops the map's Arc but not the one the stuck task holds, so the
        // guard cannot revoke — do it synchronously here too (F3).
        #[cfg(feature = "acp-mcp")]
        revoke_facade_token_for_key(&mut state, thread_id, self.session_registrar.as_ref());
        self.save_mapping(&state.persisted);
        self.save_meta(&state.session_workdirs);
        if had_active {
            info!(thread_id = %crate::redact::redact_session_ids(thread_id), "session reset");
            Ok(())
        } else {
            Err(anyhow!(
                "no session for thread {}",
                crate::redact::redact_session_ids(thread_id)
            ))
        }
    }

    pub async fn cleanup_idle(&self, ttl_secs: u64) {
        let cutoff = Instant::now() - std::time::Duration::from_secs(ttl_secs);
        let hung_threshold = std::time::Duration::from_secs(self.hung_threshold_secs);

        let (snapshot, activity_map, cancel_map, pgid_map) = {
            let state = self.state.read().await;
            let snapshot: ActiveSnapshot = state
                .active
                .iter()
                .map(|(k, v)| (k.clone(), Arc::clone(v)))
                .collect();
            (
                snapshot,
                state.activity.clone(),
                state.cancel_handles.clone(),
                state.pgids.clone(),
            )
        };

        let mut stale = Vec::new();
        let mut hung: Vec<(String, Arc<Mutex<AcpConnection>>)> = Vec::new();
        for (key, conn) in snapshot {
            // Skip active sessions for this cleanup round instead of waiting on
            // their per-connection mutex. A busy session is not idle unless hung.
            let conn_handle = Arc::clone(&conn);
            let Ok(conn) = conn.try_lock() else {
                if let Some(activity) = activity_map.get(&key) {
                    if classify_hung(
                        activity.in_flight(),
                        activity.age(),
                        hung_threshold,
                        activity.prompt_permission_wait_age(),
                    ) {
                        let session_id = cancel_map.get(&key).map(|(_, sid)| sid.clone());
                        warn_force_evicting_hung(
                            &key,
                            session_id.as_deref(),
                            activity.age().as_secs(),
                            self.hung_threshold_secs,
                        );
                        // Best-effort session/cancel via the lock-free stdin
                        // handle, detached so a wedged stdin can never block
                        // cleanup (and never while holding `state`). The hung
                        // task never unwinds, so AcpConnection::Drop never
                        // fires; after the cancel attempt, kill the child
                        // process group directly or the agent leaks forever (F4).
                        let stdin_handle = cancel_map.get(&key).map(|(stdin, _)| Arc::clone(stdin));
                        let pgid = pgid_map.get(&key).copied();
                        tokio::spawn(async move {
                            if let (Some(stdin), Some(session_id)) = (stdin_handle, session_id) {
                                let _ = tokio::time::timeout(
                                    std::time::Duration::from_secs(5),
                                    async move {
                                        if let Ok(data) =
                                            serde_json::to_string(&serde_json::json!({
                                                "jsonrpc": "2.0",
                                                "method": "session/cancel",
                                                "params": {"sessionId": session_id}
                                            }))
                                        {
                                            use tokio::io::AsyncWriteExt;
                                            let mut w = stdin.lock().await;
                                            let _ = w.write_all(data.as_bytes()).await;
                                            let _ = w.write_all(b"\n").await;
                                            let _ = w.flush().await;
                                        }
                                    },
                                )
                                .await;
                            }
                            kill_pgid_after_grace(pgid).await;
                        });
                        hung.push((key, conn_handle));
                    }
                }
                continue;
            };
            // try_lock success means no turn is streaming under
            // with_connection, so a true in_flight flag is stale (the turn
            // aborted without prompt_done). Self-heal it so the session can
            // never be falsely classified as hung later.
            if let Some(activity) = activity_map.get(&key) {
                if activity.in_flight() {
                    activity.set_in_flight(false);
                    activity.touch();
                }
            }
            if classify_idle(conn.last_active, conn.alive(), cutoff) {
                stale.push((key, conn_handle, conn.acp_session_id.clone()));
            }
        }

        if stale.is_empty() && hung.is_empty() {
            return;
        }

        let mut state = self.state.write().await;
        for (key, expected_conn, sid) in stale {
            if remove_if_same_handle(&mut state.active, &key, &expected_conn).is_some() {
                info!(thread_id = %crate::redact::redact_session_ids(&key), "cleaning up idle session");
                state.admission_permits.remove(&key);
                state.cancel_handles.remove(&key);
                state.steering_handles.remove(&key);
                state.activity.remove(&key);
                state.pgids.remove(&key);
                #[cfg(feature = "acp-mcp")]
                revoke_facade_token_for_key(&mut state, &key, self.session_registrar.as_ref());
                if let Some(sid) = sid {
                    state.persisted.insert(key.clone(), sid.clone());
                    state.suspended.insert(key, sid);
                } else {
                    state.persisted.remove(&key);
                    state.session_workdirs.remove(&key);
                }
            }
        }
        for (key, expected_conn) in hung {
            if apply_hung_eviction(&mut state, &key, &expected_conn) {
                // The DropGuard cannot fire — the hung streaming task still holds an Arc, so the
                // connection never drops. Revoke the exact token synchronously, or it keeps
                // resolving to the channel and a successor's tunnel becomes reachable by the hung
                // predecessor (F3). Safe after `apply_hung_eviction`: its `purge_session_entries`
                // leaves `facade_tokens` alone.
                #[cfg(feature = "acp-mcp")]
                revoke_facade_token_for_key(&mut state, &key, self.session_registrar.as_ref());
            } else {
                warn!(thread_id = %crate::redact::redact_session_ids(&key), "hung session was replaced before eviction; maps untouched");
            }
        }
        self.save_mapping(&state.persisted);
        self.save_meta(&state.session_workdirs);
    }

    pub async fn shutdown(&self) {
        // Snapshot active handles, then drop state lock before awaiting
        // per-connection mutexes (lock ordering: never hold state while
        // awaiting a connection lock).
        let snapshot: Vec<(String, Arc<Mutex<AcpConnection>>)> = {
            let state = self.state.read().await;
            state
                .active
                .iter()
                .map(|(k, v)| (k.clone(), Arc::clone(v)))
                .collect()
        };

        let mut session_ids: Vec<(String, String)> = Vec::new();
        for (key, conn) in snapshot {
            let conn = conn.lock().await;
            if let Some(sid) = conn.acp_session_id.clone() {
                session_ids.push((key, sid));
            }
        }

        let mut state = self.state.write().await;
        for (key, sid) in session_ids {
            state.persisted.insert(key.clone(), sid.clone());
            state.suspended.insert(key, sid);
        }
        self.save_mapping(&state.persisted);
        let count = state.active.len();
        state.active.clear();
        state.admission_permits.clear();
        state.cancel_handles.clear();
        state.steering_handles.clear();
        state.activity.clear();
        state.pgids.clear();
        info!(count, "pool shutdown complete");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        better_candidate, candidate_awaiting_permission, candidate_in_flight, candidate_relaying,
        classify_hung, classify_idle, get_or_insert_gate, purge_session_entries,
        relay_is_streaming, remove_if_same_handle, PoolState, AGENT_RELAY_GRACE_SECS,
    };
    use crate::acp::connection::SessionActivity;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tokio::time::Instant;

    /// Registrar double that records every mint, so a test can assert one never happened.
    #[cfg(feature = "acp-mcp")]
    #[derive(Default)]
    struct CountingRegistrar {
        minted: std::sync::Mutex<Vec<String>>,
        revoked: std::sync::Mutex<Vec<String>>,
    }

    #[cfg(feature = "acp-mcp")]
    impl CountingRegistrar {
        fn revoked(&self) -> Vec<String> {
            self.revoked.lock().unwrap().clone()
        }
    }

    #[cfg(feature = "acp-mcp")]
    impl crate::acp_mcp::SessionTokenRegistrar for CountingRegistrar {
        fn mint(&self, channel_id: &str) -> String {
            self.minted.lock().unwrap().push(channel_id.to_string());
            "token-xyz".to_string()
        }
        fn revoke(&self, token: &str) {
            self.revoked.lock().unwrap().push(token.to_string());
        }
    }

    /// Build an empty `PoolState` for a helper-level test.
    #[cfg(feature = "acp-mcp")]
    fn empty_pool_state() -> super::PoolState {
        super::PoolState {
            active: HashMap::new(),
            admission_permits: HashMap::new(),
            cancel_handles: HashMap::new(),
            steering_handles: HashMap::new(),
            facade_tokens: HashMap::new(),
            activity: HashMap::new(),
            pgids: HashMap::new(),
            suspended: HashMap::new(),
            persisted: HashMap::new(),
            creating: HashMap::new(),
            session_workdirs: HashMap::new(),
            session_mcp_servers: HashMap::new(),
            session_meta: HashMap::new(),
        }
    }

    /// F3: replacing a hung predecessor's token revokes the predecessor's EXACT token and leaves
    /// the successor's standing. Without the revoke the predecessor token keeps resolving to the
    /// channel and — since `AcpTunnelSource` authorizes by channel — could reach the successor's
    /// tunnel. Exercises the production `install_facade_token`.
    #[cfg(feature = "acp-mcp")]
    #[test]
    fn installing_a_successor_token_revokes_only_the_superseded_predecessor() {
        let reg = Arc::new(CountingRegistrar::default());
        let registrar: Arc<dyn crate::acp_mcp::SessionTokenRegistrar> = reg.clone();
        let mut state = empty_pool_state();

        // Predecessor registers, then a successor takes over the SAME key.
        super::install_facade_token(
            &mut state,
            "discord:acp_x",
            "T_pred".into(),
            Some(&registrar),
        );
        assert!(
            reg.revoked().is_empty(),
            "nothing to revoke on the first install"
        );
        super::install_facade_token(
            &mut state,
            "discord:acp_x",
            "T_succ".into(),
            Some(&registrar),
        );

        assert_eq!(
            reg.revoked(),
            vec!["T_pred"],
            "the predecessor token must be revoked"
        );
        assert_eq!(
            state.facade_tokens.get("discord:acp_x").map(String::as_str),
            Some("T_succ"),
            "the successor's token stands"
        );
    }

    /// F3: hung eviction revokes the exact facade token synchronously (the DropGuard cannot fire
    /// while the hung task holds an Arc). Exercises the production `revoke_facade_token_for_key`,
    /// which the hung-eviction loop calls after `apply_hung_eviction`.
    #[cfg(feature = "acp-mcp")]
    #[test]
    fn hung_eviction_revokes_the_exact_facade_token_and_forgets_it() {
        let reg = Arc::new(CountingRegistrar::default());
        let registrar: Arc<dyn crate::acp_mcp::SessionTokenRegistrar> = reg.clone();
        let mut state = empty_pool_state();
        state
            .facade_tokens
            .insert("discord:acp_x".into(), "T_hung".into());
        // A different session's token must be untouched.
        state
            .facade_tokens
            .insert("discord:acp_y".into(), "T_other".into());

        super::revoke_facade_token_for_key(&mut state, "discord:acp_x", Some(&registrar));

        assert_eq!(
            reg.revoked(),
            vec!["T_hung"],
            "only the evicted session's token is revoked"
        );
        assert!(
            !state.facade_tokens.contains_key("discord:acp_x"),
            "and it is forgotten"
        );
        assert_eq!(
            state.facade_tokens.get("discord:acp_y").map(String::as_str),
            Some("T_other"),
            "an unrelated session's token is untouched"
        );
    }

    /// A failed facade config write must not mint a token. The agent has no `openab` entry, so it
    /// can never present one; minting anyway would leave a live credential registered for a
    /// session that cannot use it until eviction.
    #[cfg(feature = "acp-mcp")]
    #[tokio::test]
    async fn no_token_is_minted_when_the_facade_config_write_fails() {
        let dir = tempfile::tempdir().unwrap();
        // Make `<workdir>/.openab` a FILE, so `create_dir_all` inside the writer fails.
        //
        // This used to block on `.cursor`, which openab no longer creates: since D-15 it authors
        // only `.openab/mcp-facade.json` and never touches a vendor directory. Left pointing at
        // `.cursor` the write would SUCCEED, the test would fail, and — worse if it had been
        // written the other way round — a test asserting "no mint on failure" would have been
        // passing against a call that never failed.
        std::fs::write(dir.path().join(".openab"), b"not a directory").unwrap();

        let counting = Arc::new(CountingRegistrar::default());
        let registrar: Arc<dyn crate::acp_mcp::SessionTokenRegistrar> = counting.clone();
        let token = super::setup_facade_session(
            dir.path().to_str().unwrap(),
            "http://127.0.0.1:8848/mcp",
            "acp_x",
            &registrar,
        )
        .await;

        assert!(token.is_none(), "a failed config write must yield no token");
        assert!(
            counting.minted.lock().unwrap().is_empty(),
            "the registrar must never be asked to mint when the config could not be written"
        );
    }

    /// The happy path still mints exactly once, for the right channel.
    #[cfg(feature = "acp-mcp")]
    #[tokio::test]
    async fn a_successful_facade_config_write_mints_one_token() {
        let dir = tempfile::tempdir().unwrap();
        let counting = Arc::new(CountingRegistrar::default());
        let registrar: Arc<dyn crate::acp_mcp::SessionTokenRegistrar> = counting.clone();
        let token = super::setup_facade_session(
            dir.path().to_str().unwrap(),
            "http://127.0.0.1:8848/mcp",
            "acp_x",
            &registrar,
        )
        .await;

        assert_eq!(token.as_deref(), Some("token-xyz"));
        assert_eq!(counting.minted.lock().unwrap().as_slice(), ["acp_x"]);
    }

    #[test]
    fn remove_if_same_handle_removes_matching_entry() {
        let expected = Arc::new(Mutex::new(1_u8));
        let mut map = HashMap::from([("thread".to_string(), Arc::clone(&expected))]);

        let removed = remove_if_same_handle(&mut map, "thread", &expected);

        assert!(removed.is_some());
        assert!(map.is_empty());
    }

    #[test]
    fn remove_if_same_handle_keeps_replaced_entry() {
        let stale = Arc::new(Mutex::new(1_u8));
        let fresh = Arc::new(Mutex::new(2_u8));
        let mut map = HashMap::from([("thread".to_string(), Arc::clone(&fresh))]);

        let removed = remove_if_same_handle(&mut map, "thread", &stale);

        assert!(removed.is_none());
        let current = map.get("thread").expect("entry should remain");
        assert!(Arc::ptr_eq(current, &fresh));
    }

    #[test]
    fn get_or_insert_gate_reuses_gate_for_same_thread() {
        let mut map = HashMap::new();

        let first = get_or_insert_gate(&mut map, "thread");
        let second = get_or_insert_gate(&mut map, "thread");

        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn classify_idle_marks_stale_by_time() {
        let now = Instant::now();
        let cutoff = now - std::time::Duration::from_secs(60);
        let last_active = now - std::time::Duration::from_secs(120);
        assert!(classify_idle(last_active, true, cutoff));
    }

    #[test]
    fn classify_idle_marks_stale_by_death() {
        let now = Instant::now();
        let cutoff = now - std::time::Duration::from_secs(60);
        assert!(classify_idle(now, false, cutoff));
    }

    #[test]
    fn classify_idle_keeps_fresh_alive_sessions() {
        let now = Instant::now();
        let cutoff = now - std::time::Duration::from_secs(60);
        assert!(!classify_idle(now, true, cutoff));
    }

    #[test]
    fn better_candidate_prefers_empty_current() {
        assert!(better_candidate(None, Instant::now()));
    }

    #[test]
    fn better_candidate_prefers_older_last_active() {
        let older = Instant::now() - std::time::Duration::from_secs(120);
        let newer = Instant::now() - std::time::Duration::from_secs(30);
        assert!(better_candidate(Some(newer), older));
    }

    #[test]
    fn better_candidate_rejects_newer_last_active() {
        let older = Instant::now() - std::time::Duration::from_secs(120);
        let newer = Instant::now() - std::time::Duration::from_secs(30);
        assert!(!better_candidate(Some(older), newer));
    }

    #[test]
    fn classify_hung_detects_in_flight_session_past_threshold() {
        assert!(classify_hung(
            true,
            std::time::Duration::from_secs(200),
            std::time::Duration::from_secs(120),
            None,
        ));
    }

    #[test]
    fn classify_hung_ignores_in_flight_session_within_threshold() {
        assert!(!classify_hung(
            true,
            std::time::Duration::from_secs(30),
            std::time::Duration::from_secs(120),
            None,
        ));
    }

    #[test]
    fn classify_hung_never_marks_idle_sessions() {
        assert!(!classify_hung(
            false,
            std::time::Duration::from_secs(200),
            std::time::Duration::from_secs(120),
            None,
        ));
    }

    #[test]
    fn classify_hung_ignores_recent_prompt_permission_wait() {
        assert!(!classify_hung(
            true,
            std::time::Duration::from_secs(200),
            std::time::Duration::from_secs(120),
            Some(std::time::Duration::from_secs(30)),
        ));
    }

    #[test]
    fn classify_hung_bounds_prompt_permission_wait() {
        assert!(classify_hung(
            true,
            std::time::Duration::from_secs(200),
            std::time::Duration::from_secs(120),
            Some(std::time::Duration::from_secs(200)),
        ));
    }

    #[test]
    fn better_candidate_keeps_existing_on_equal_last_active() {
        let ts = Instant::now() - std::time::Duration::from_secs(60);
        assert!(!better_candidate(Some(ts), ts));
    }

    /// A session parked on `session/request_permission` holds no connection lock
    /// and stops touching `last_active`, so the pool-full scan used to pick it as
    /// the "oldest idle" victim and kill its agent mid-turn. `in_flight` is the
    /// only signal that survives that parking, so it is what the scan must use.
    #[test]
    fn candidate_in_flight_protects_parked_turn() {
        let activity = SessionActivity::new();
        activity.set_in_flight(true);
        assert!(candidate_in_flight(Some(&activity)));
    }

    #[test]
    fn candidate_in_flight_allows_idle_session() {
        let activity = SessionActivity::new();
        assert!(!candidate_in_flight(Some(&activity)));
    }

    /// No handle means the scan cannot inspect the entry; keep the old behaviour
    /// of treating it as evictable rather than pinning the pool shut.
    #[test]
    fn candidate_in_flight_treats_missing_handle_as_evictable() {
        assert!(!candidate_in_flight(None));
    }

    /// An agent-initiated turn (scheduled wakeup, post-turn write-back) streams
    /// through the idle subscriber: no mutex held, `in_flight` false, and
    /// `last_active` frozen at the end of the last client prompt. Only the relay
    /// stamp keeps such a session out of the victim set.
    #[test]
    fn candidate_relaying_protects_a_session_mid_agent_turn() {
        let activity = SessionActivity::new();
        activity.mark_agent_relay();
        assert!(!candidate_in_flight(Some(&activity)));
        assert!(candidate_relaying(
            Some(&activity),
            std::time::Duration::from_secs(AGENT_RELAY_GRACE_SECS),
        ));
    }

    #[test]
    fn candidate_relaying_allows_a_session_that_never_relayed() {
        let activity = SessionActivity::new();
        activity.touch();
        assert!(!candidate_relaying(
            Some(&activity),
            std::time::Duration::from_secs(AGENT_RELAY_GRACE_SECS),
        ));
    }

    #[test]
    fn candidate_relaying_treats_missing_handle_as_evictable() {
        assert!(!candidate_relaying(
            None,
            std::time::Duration::from_secs(AGENT_RELAY_GRACE_SECS),
        ));
    }

    /// The gap the relay freshness window alone leaves open: a turn parked on a
    /// permission request forwards nothing, so its relay stamp ages past the
    /// grace while the user is still deciding.
    #[test]
    fn candidate_awaiting_permission_protects_a_turn_parked_on_a_decision() {
        let activity = SessionActivity::new();
        let hung = std::time::Duration::from_secs(1_920);

        activity.mark_agent_relay();
        activity.begin_agent_permission_wait();
        assert!(candidate_awaiting_permission(Some(&activity), hung));
        // And the protection is not permanent: a wait older than the hung
        // threshold stops holding the slot.
        assert!(!candidate_awaiting_permission(
            Some(&activity),
            std::time::Duration::ZERO,
        ));
    }

    #[test]
    fn candidate_awaiting_permission_is_false_once_the_decision_lands() {
        let activity = SessionActivity::new();
        let hung = std::time::Duration::from_secs(1_920);

        activity.begin_agent_permission_wait();
        activity.end_agent_permission_wait();
        assert!(!candidate_awaiting_permission(Some(&activity), hung));
    }

    #[test]
    fn candidate_awaiting_permission_ignores_sessions_that_never_waited() {
        let activity = SessionActivity::new();
        let hung = std::time::Duration::from_secs(1_920);

        activity.mark_agent_relay();
        assert!(!candidate_awaiting_permission(Some(&activity), hung));
        assert!(!candidate_awaiting_permission(None, hung));
    }

    #[test]
    fn relay_is_streaming_releases_a_session_silent_past_the_grace() {
        let grace = std::time::Duration::from_secs(AGENT_RELAY_GRACE_SECS);
        assert!(relay_is_streaming(std::time::Duration::from_secs(3), grace));
        assert!(!relay_is_streaming(grace, grace));
        assert!(!relay_is_streaming(
            grace + std::time::Duration::from_secs(1),
            grace,
        ));
    }

    /// The force-evict warning must log NEITHER id raw — both the `acp_<uuid>` channel (inside the
    /// `<platform>:<channel_id>` pool key) and the `sess_<uuid>` session id resume the session. A
    /// capture subscriber exercises the real `warn!` macro, so a revert to raw fields fails here
    /// rather than silently shipping a credential to the logs (F6 / round 6).
    #[test]
    fn force_evict_warning_redacts_both_ids() {
        use std::io::Write;
        use std::sync::{Arc as StdArc, Mutex as StdMutex};

        #[derive(Clone)]
        struct Cap(StdArc<StdMutex<Vec<u8>>>);
        impl Write for Cap {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let uuid = "00000000-0000-0000-0000-000000000000";
        let buf = StdArc::new(StdMutex::new(Vec::new()));
        let cap = Cap(buf.clone());
        let sub = tracing_subscriber::fmt()
            .with_writer(move || cap.clone())
            .with_ansi(false)
            .finish();
        tracing::subscriber::with_default(sub, || {
            super::warn_force_evicting_hung(
                &format!("discord:acp_{uuid}"),
                Some(&format!("sess_{uuid}")),
                999,
                600,
            );
        });

        let out = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
        assert!(
            out.contains("force-evicting hung session"),
            "the warning must fire: {out}"
        );
        assert!(!out.contains(uuid), "no raw uuid may reach the log: {out}");
        assert!(
            !out.contains("acp_") && !out.contains("sess_"),
            "no raw id prefix either: {out}"
        );
        assert!(
            out.contains('#'),
            "the redaction tag must be present: {out}"
        );
        assert!(
            out.contains("discord"),
            "the readable platform half must survive: {out}"
        );
    }

    #[test]
    fn purge_session_entries_drops_all_entries_for_evicted_key_only() {
        let admission = Arc::new(tokio::sync::Semaphore::new(1));
        let admission_permit = Arc::clone(&admission)
            .try_acquire_owned()
            .expect("test permit");
        let mut state = PoolState {
            active: HashMap::new(),
            admission_permits: HashMap::from([("hung".to_string(), admission_permit)]),
            cancel_handles: HashMap::new(),
            steering_handles: HashMap::new(),
            #[cfg(feature = "acp-mcp")]
            facade_tokens: HashMap::new(),
            activity: HashMap::from([
                ("hung".to_string(), Arc::new(SessionActivity::new())),
                ("other".to_string(), Arc::new(SessionActivity::new())),
            ]),
            pgids: HashMap::from([("hung".to_string(), 1234), ("other".to_string(), 5678)]),
            suspended: HashMap::from([
                ("hung".to_string(), "session-hung".to_string()),
                ("other".to_string(), "session-other".to_string()),
            ]),
            persisted: HashMap::from([
                ("hung".to_string(), "session-hung".to_string()),
                ("other".to_string(), "session-other".to_string()),
            ]),
            creating: HashMap::from([("hung".to_string(), Arc::new(Mutex::new(())))]),
            session_workdirs: HashMap::from([("hung".to_string(), "/tmp/ws".to_string())]),
            session_mcp_servers: HashMap::from([(
                "hung".to_string(),
                vec![serde_json::json!({"type": "http", "name": "x", "url": "http://x"})],
            )]),
            session_meta: HashMap::from([(
                "hung".to_string(),
                serde_json::json!({"systemPrompt": "x"}),
            )]),
        };

        purge_session_entries(&mut state, "hung");

        assert_eq!(
            admission.available_permits(),
            1,
            "evicting logical session state must release its pool slot"
        );
        // Evicted key must not be resumable: no suspended/persisted entry left.
        assert!(!state.activity.contains_key("hung"));
        assert!(!state.cancel_handles.contains_key("hung"));
        assert!(!state.pgids.contains_key("hung"));
        assert!(!state.suspended.contains_key("hung"));
        assert!(!state.persisted.contains_key("hung"));
        assert!(!state.session_workdirs.contains_key("hung"));
        assert!(!state.session_mcp_servers.contains_key("hung"));
        assert!(!state.session_meta.contains_key("hung"));
        // The creating gate is concurrency control, not session state: it must
        // survive so an in-flight get_or_create holder stays serialized.
        assert!(state.creating.contains_key("hung"));
        assert_eq!(state.pgids.get("other"), Some(&5678));
        // Other keys survive untouched.
        assert_eq!(
            state.persisted.get("other"),
            Some(&"session-other".to_string())
        );
        assert_eq!(
            state.suspended.get("other"),
            Some(&"session-other".to_string())
        );
        assert!(state.activity.contains_key("other"));
    }

    #[test]
    fn persisted_mapping_can_include_active_and_suspended_sessions() {
        let persisted = HashMap::from([
            ("active-thread".to_string(), "session-active".to_string()),
            (
                "suspended-thread".to_string(),
                "session-suspended".to_string(),
            ),
        ]);

        let serialized =
            serde_json::to_string_pretty(&persisted).expect("serialize persisted mapping");
        let roundtrip: HashMap<String, String> =
            serde_json::from_str(&serialized).expect("deserialize persisted mapping");

        assert_eq!(
            roundtrip.get("active-thread"),
            Some(&"session-active".to_string())
        );
        assert_eq!(
            roundtrip.get("suspended-thread"),
            Some(&"session-suspended".to_string())
        );
    }
}
