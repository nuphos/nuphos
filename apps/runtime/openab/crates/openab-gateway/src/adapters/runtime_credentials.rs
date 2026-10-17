//! Per-binding `/acp` credentials for a runtime console (`OPENAB_RUNTIME_CONSOLE`).
//!
//! Each connection the runtime hands out (a "binding") has its own transport key and
//! control key. Only their SHA-256 digests are stored, in `bindings.json` under
//! `OPENAB_RUNTIME_STATE_DIR`. Revoking a binding removes it and closes its live sockets.
//! `OPENAB_ACP_AUTH_KEY` / `OPENAB_ACP_CONTROL_KEY` keep working as deployment
//! principals that no console action can revoke.

use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;
use tokio::sync::broadcast;
use tracing::{error, info, warn};

use super::runtime_pairing::PairingCodes;
use super::session_owners::SessionOwners;

pub const TRANSPORT_PREFIX: &str = "nrt_";
pub const CONTROL_PREFIX: &str = "nrc_";
/// Must match `deriveRuntimeControlKey` in the Nuphos backend and the nuphos-runtime entrypoint.
const LEGACY_CONTROL_CONTEXT: &[u8] = b"nuphos-runtime-control-v1";
const LEGACY_BINDING_ID: &str = "legacy";
const BINDINGS_FILE: &str = "bindings.json";
const INSTANCE_ID_FILE: &str = "instance-id";
const PENDING_TTL_SECS: i64 = 15 * 60;
const LAST_USED_FLUSH: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Transport,
    Control,
}

/// Who a `/acp` bearer token belongs to. `binding_id` is `None` for a deployment key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Principal {
    pub binding_id: Option<String>,
    pub role: Role,
}

impl Principal {
    /// The binding whose sessions this principal is confined to. Deployment keys and the
    /// legacy-password binding are single-tenant and see every session.
    pub fn session_scope(&self) -> Option<&str> {
        self.binding_id
            .as_deref()
            .filter(|id| *id != LEGACY_BINDING_ID)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BindingSource {
    Pairing,
    LegacyPassword,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BindingState {
    Pending,
    Active,
}

/// What the paired application said about itself. Display only; never trusted.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BindingClient {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend_origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paired_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_record_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub id: String,
    pub label: String,
    pub source: BindingSource,
    pub state: BindingState,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activated_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<DateTime<Utc>>,
    transport_key_sha256: String,
    control_key_sha256: String,
    #[serde(default)]
    pub client: BindingClient,
}

impl Binding {
    pub fn pending_until(&self) -> Option<DateTime<Utc>> {
        (self.state == BindingState::Pending)
            .then(|| self.created_at + chrono::Duration::seconds(PENDING_TTL_SECS))
    }
}

/// A freshly created binding. The keys exist only here; the store keeps their digests.
pub struct IssuedBinding {
    pub id: String,
    pub transport_key: String,
    pub control_key: String,
    pub pending_until: DateTime<Utc>,
}

struct Inner {
    bindings: Vec<Binding>,
    last_flush: Instant,
    unflushed_use: bool,
}

pub struct CredentialStore {
    dir: Option<PathBuf>,
    instance_id: String,
    pub pairing: PairingCodes,
    pub sessions: SessionOwners,
    env_transport: Option<String>,
    env_control: Option<String>,
    inner: Mutex<Inner>,
    revocations: broadcast::Sender<String>,
}

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    hex(&buf)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_hex(input: &[u8]) -> String {
    hex(&Sha256::digest(input))
}

fn legacy_control_key(password: &str) -> String {
    use hmac::{Hmac, Mac};
    let mut mac = Hmac::<Sha256>::new_from_slice(password.as_bytes())
        .expect("HMAC accepts a key of any length");
    mac.update(LEGACY_CONTROL_CONTEXT);
    hex(&mac.finalize().into_bytes())
}

fn ct_eq(a: &str, b: &str) -> bool {
    bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}

/// Read a legacy password file the way the nuphos-runtime entrypoint did: trailing
/// line breaks stripped, empty meaning absent.
pub fn read_legacy_key(path: &Path) -> Option<(String, DateTime<Utc>)> {
    let raw = std::fs::read_to_string(path).ok()?;
    let key: String = raw.chars().filter(|c| *c != '\r' && *c != '\n').collect();
    if key.is_empty() {
        return None;
    }
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map(DateTime::<Utc>::from)
        .unwrap_or_else(|_| Utc::now());
    Some((key, modified))
}

pub fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

fn private_file_options() -> std::fs::OpenOptions {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options
}

/// Write `bytes` to a new owner-only temp file beside `path` and return its path.
pub fn write_private_temp(path: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    use std::io::Write;
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    ensure_private_dir(dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("state");
    let tmp = dir.join(format!(".{name}.{}", random_hex(6)));
    let mut file = private_file_options().open(&tmp)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(tmp)
}

pub fn write_private_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = write_private_temp(path, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

fn load_instance_id(dir: &Path) -> std::io::Result<String> {
    let path = dir.join(INSTANCE_ID_FILE);
    match std::fs::read_to_string(&path) {
        Ok(existing) if !existing.trim().is_empty() => return Ok(existing.trim().to_string()),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let id = uuid::Uuid::new_v4().to_string();
    let tmp = write_private_temp(&path, id.as_bytes())?;
    // `hard_link` refuses to replace an existing file, so a concurrent writer's id wins.
    let linked = std::fs::hard_link(&tmp, &path);
    let _ = std::fs::remove_file(&tmp);
    match linked {
        Ok(()) => Ok(id),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Ok(std::fs::read_to_string(&path)?.trim().to_string())
        }
        Err(e) => Err(e),
    }
}

impl CredentialStore {
    /// A store that persists nothing. For tests and for callers that only need env principals.
    pub fn in_memory(env_transport: Option<String>, env_control: Option<String>) -> Self {
        Self::with_bindings(
            None,
            env_transport,
            env_control,
            Vec::new(),
            SessionOwners::default(),
        )
    }

    fn with_bindings(
        dir: Option<PathBuf>,
        env_transport: Option<String>,
        env_control: Option<String>,
        bindings: Vec<Binding>,
        sessions: SessionOwners,
    ) -> Self {
        let (revocations, _) = broadcast::channel(64);
        let instance_id = dir
            .as_deref()
            .and_then(|d| load_instance_id(d).map_err(|e| error!(error = %e, "runtime instance id could not be stored; using one for this process only")).ok())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        Self {
            dir,
            instance_id,
            pairing: PairingCodes::from_env(),
            sessions,
            env_transport: env_transport.filter(|k| !k.is_empty()),
            env_control: env_control.filter(|k| !k.is_empty()),
            inner: Mutex::new(Inner {
                bindings,
                last_flush: Instant::now(),
                unflushed_use: false,
            }),
            revocations,
        }
    }

    /// Load `bindings.json` from `dir`. When it does not exist yet and `legacy_key_file`
    /// holds a password, that password becomes a `legacy-password` binding so every
    /// application already using it keeps working. An unreadable or corrupt file is an
    /// error: silently starting empty would revoke every binding on the next write.
    pub fn open(
        dir: PathBuf,
        legacy_key_file: Option<&Path>,
        env_transport: Option<String>,
        env_control: Option<String>,
    ) -> anyhow::Result<Self> {
        ensure_private_dir(&dir)?;
        let path = dir.join(BINDINGS_FILE);
        let (bindings, imported) = match std::fs::read(&path) {
            Ok(bytes) => (serde_json::from_slice::<Vec<Binding>>(&bytes)?, false),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let legacy = legacy_key_file.and_then(read_legacy_key);
                let bindings = legacy
                    .map(|(key, created_at)| vec![Self::legacy_binding(&key, created_at)])
                    .unwrap_or_default();
                let imported = !bindings.is_empty();
                (bindings, imported)
            }
            Err(e) => return Err(e.into()),
        };
        let sessions = SessionOwners::open(&dir)?;
        let store = Self::with_bindings(Some(dir), env_transport, env_control, bindings, sessions);
        if imported {
            store.save(&store.inner.lock())?;
            info!("runtime credentials: imported the legacy runtime password as a binding");
        }
        Ok(store)
    }

    fn legacy_binding(password: &str, created_at: DateTime<Utc>) -> Binding {
        Binding {
            id: LEGACY_BINDING_ID.into(),
            label: "Runtime password".into(),
            source: BindingSource::LegacyPassword,
            state: BindingState::Active,
            created_at,
            activated_at: Some(created_at),
            last_used_at: None,
            transport_key_sha256: sha256_hex(password.as_bytes()),
            control_key_sha256: sha256_hex(legacy_control_key(password).as_bytes()),
            client: BindingClient::default(),
        }
    }

    fn save(&self, inner: &Inner) -> std::io::Result<()> {
        let Some(dir) = &self.dir else {
            return Ok(());
        };
        let json = serde_json::to_vec_pretty(&inner.bindings).map_err(std::io::Error::other)?;
        write_private_atomic(&dir.join(BINDINGS_FILE), &json)
    }

    fn save_logged(&self, inner: &mut Inner) {
        match self.save(inner) {
            Ok(()) => {
                inner.last_flush = Instant::now();
                inner.unflushed_use = false;
            }
            Err(e) => error!(error = %e, "runtime credentials: could not write bindings"),
        }
    }

    /// Drop pending bindings nobody ever used — an exchange whose response never reached
    /// the application that asked for it.
    fn prune_pending(&self, inner: &mut Inner, now: DateTime<Utc>) {
        let before = inner.bindings.len();
        inner
            .bindings
            .retain(|b| b.pending_until().is_none_or(|until| until > now));
        if inner.bindings.len() != before {
            self.save_logged(inner);
        }
    }

    /// This runtime's stable identity, created once per state directory. It lets an
    /// application recognise the same runtime behind a different URL.
    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    pub fn has_env_transport(&self) -> bool {
        self.env_transport.is_some()
    }

    pub fn has_env_control(&self) -> bool {
        self.env_control.is_some()
    }

    pub fn authenticate(&self, token: &str) -> Option<Principal> {
        self.authenticate_at(token, Utc::now())
    }

    fn authenticate_at(&self, token: &str, now: DateTime<Utc>) -> Option<Principal> {
        if token.is_empty() {
            return None;
        }
        if self.env_control.as_deref().is_some_and(|k| ct_eq(token, k)) {
            return Some(Principal {
                binding_id: None,
                role: Role::Control,
            });
        }
        if self
            .env_transport
            .as_deref()
            .is_some_and(|k| ct_eq(token, k))
        {
            return Some(Principal {
                binding_id: None,
                role: Role::Transport,
            });
        }
        let digest = sha256_hex(token.as_bytes());
        let mut inner = self.inner.lock();
        self.prune_pending(&mut inner, now);
        let (index, role) = inner.bindings.iter().enumerate().find_map(|(i, b)| {
            if ct_eq(&digest, &b.transport_key_sha256) {
                Some((i, Role::Transport))
            } else if ct_eq(&digest, &b.control_key_sha256) {
                Some((i, Role::Control))
            } else {
                None
            }
        })?;
        let binding = &mut inner.bindings[index];
        binding.last_used_at = Some(now);
        let id = binding.id.clone();
        let activated = binding.state == BindingState::Pending;
        if activated {
            binding.state = BindingState::Active;
            binding.activated_at = Some(now);
            info!(binding = %id, "runtime credentials: binding activated on first use");
        }
        inner.unflushed_use = true;
        if activated || inner.last_flush.elapsed() >= LAST_USED_FLUSH {
            self.save_logged(&mut inner);
        }
        Some(Principal {
            binding_id: Some(id),
            role,
        })
    }

    /// Fails when the binding cannot be written: keys that would stop working after a
    /// restart are never handed out.
    pub fn create_pending(
        &self,
        label: String,
        client: BindingClient,
    ) -> std::io::Result<IssuedBinding> {
        let now = Utc::now();
        let id = random_hex(12);
        let transport_key = format!("{TRANSPORT_PREFIX}{id}_{}", random_hex(32));
        let control_key = format!("{CONTROL_PREFIX}{id}_{}", random_hex(32));
        let binding = Binding {
            id: id.clone(),
            label,
            source: BindingSource::Pairing,
            state: BindingState::Pending,
            created_at: now,
            activated_at: None,
            last_used_at: None,
            transport_key_sha256: sha256_hex(transport_key.as_bytes()),
            control_key_sha256: sha256_hex(control_key.as_bytes()),
            client,
        };
        let pending_until = binding.pending_until().unwrap_or(now);
        let mut inner = self.inner.lock();
        self.prune_pending(&mut inner, now);
        inner.bindings.push(binding);
        if let Err(e) = self.save(&inner) {
            inner.bindings.pop();
            error!(error = %e, "runtime credentials: could not write bindings");
            return Err(e);
        }
        inner.last_flush = Instant::now();
        inner.unflushed_use = false;
        info!(binding = %id, "runtime credentials: pending binding created");
        Ok(IssuedBinding {
            id,
            transport_key,
            control_key,
            pending_until,
        })
    }

    /// `Ok(false)` when there is no such binding. A revoke that cannot be written is
    /// undone and reported, so a revoked key can never come back with a restart.
    pub fn revoke(&self, id: &str) -> std::io::Result<bool> {
        let mut inner = self.inner.lock();
        let Some(index) = inner.bindings.iter().position(|b| b.id == id) else {
            return Ok(false);
        };
        let removed = inner.bindings.remove(index);
        if let Err(e) = self.save(&inner) {
            inner.bindings.insert(index, removed);
            error!(binding = %id, error = %e, "runtime credentials: could not write the revoke; binding kept");
            return Err(e);
        }
        inner.last_flush = Instant::now();
        inner.unflushed_use = false;
        drop(inner);
        self.sessions.release_binding(id);
        warn!(binding = %id, "runtime credentials: binding revoked");
        let _ = self.revocations.send(id.to_string());
        Ok(true)
    }

    pub fn contains(&self, id: &str) -> bool {
        self.inner.lock().bindings.iter().any(|b| b.id == id)
    }

    pub fn get(&self, id: &str) -> Option<Binding> {
        let mut inner = self.inner.lock();
        self.prune_pending(&mut inner, Utc::now());
        inner.bindings.iter().find(|b| b.id == id).cloned()
    }

    pub fn list(&self) -> Vec<Binding> {
        let mut inner = self.inner.lock();
        self.prune_pending(&mut inner, Utc::now());
        inner.bindings.clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.revocations.subscribe()
    }

    /// Resolves once `binding_id` has been revoked. Never resolves for a deployment key.
    pub async fn revoked(
        self: &Arc<Self>,
        binding_id: Option<&str>,
        revocations: &mut Option<broadcast::Receiver<String>>,
    ) {
        let (Some(id), Some(rx)) = (binding_id, revocations.as_mut()) else {
            return std::future::pending().await;
        };
        loop {
            match rx.recv().await {
                Ok(revoked) if revoked == id => return,
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    if !self.contains(id) {
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => {
                    return std::future::pending().await;
                }
            }
        }
    }

    /// Persist the last-used times that have not reached disk yet.
    pub fn flush(&self) {
        let mut inner = self.inner.lock();
        if inner.unflushed_use {
            self.save_logged(&mut inner);
        }
    }
}

pub fn console_enabled() -> bool {
    std::env::var("OPENAB_RUNTIME_CONSOLE")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

pub fn state_dir() -> PathBuf {
    std::env::var("OPENAB_RUNTIME_STATE_DIR")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
            PathBuf::from(home).join(".openab-runtime")
        })
}

pub fn legacy_key_file(dir: &Path) -> PathBuf {
    std::env::var("OPENAB_RUNTIME_LEGACY_KEY_FILE")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join("auth-key"))
}

/// The store `/acp` authenticates against when `OPENAB_RUNTIME_CONSOLE` is on, `None`
/// when it is off. A state directory that cannot be used yields a store holding only the
/// deployment keys, never keyless access.
pub fn from_env(
    env_transport: Option<&String>,
    env_control: Option<&String>,
) -> Option<Arc<CredentialStore>> {
    if !console_enabled() {
        return None;
    }
    let dir = state_dir();
    let legacy = legacy_key_file(&dir);
    match CredentialStore::open(
        dir.clone(),
        Some(&legacy),
        env_transport.cloned(),
        env_control.cloned(),
    ) {
        Ok(store) => {
            info!(dir = %dir.display(), "runtime credentials enabled");
            Some(Arc::new(store))
        }
        Err(e) => {
            error!(dir = %dir.display(), error = %e, "runtime credentials unavailable; /acp accepts only deployment keys");
            Some(Arc::new(CredentialStore::in_memory(
                env_transport.cloned(),
                env_control.cloned(),
            )))
        }
    }
}

#[cfg(test)]
pub(crate) fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("openab-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issued_keys_authenticate_with_their_own_role() {
        let store = CredentialStore::in_memory(None, None);
        let issued = store
            .create_pending("Team".into(), BindingClient::default())
            .unwrap();
        assert!(issued.transport_key.starts_with(TRANSPORT_PREFIX));
        assert!(issued.control_key.starts_with(CONTROL_PREFIX));
        assert_ne!(issued.transport_key, issued.control_key);
        assert!(issued
            .transport_key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_'));

        let transport = store.authenticate(&issued.transport_key).unwrap();
        assert_eq!(transport.role, Role::Transport);
        assert_eq!(transport.binding_id.as_deref(), Some(issued.id.as_str()));
        let control = store.authenticate(&issued.control_key).unwrap();
        assert_eq!(control.role, Role::Control);
        assert!(store.authenticate("nrt_nope").is_none());
        assert!(store.authenticate("").is_none());
    }

    #[test]
    fn first_use_activates_and_unused_pending_expires() {
        let store = CredentialStore::in_memory(None, None);
        let used = store
            .create_pending("used".into(), BindingClient::default())
            .unwrap();
        let unused = store
            .create_pending("unused".into(), BindingClient::default())
            .unwrap();
        assert_eq!(store.get(&used.id).unwrap().state, BindingState::Pending);

        store.authenticate(&used.control_key).unwrap();
        let active = store.get(&used.id).unwrap();
        assert_eq!(active.state, BindingState::Active);
        assert!(active.activated_at.is_some() && active.last_used_at.is_some());

        let later = Utc::now() + chrono::Duration::seconds(PENDING_TTL_SECS + 1);
        assert!(store
            .authenticate_at(&unused.transport_key, later)
            .is_none());
        assert!(!store.contains(&unused.id));
        assert!(store.authenticate_at(&used.transport_key, later).is_some());
    }

    #[test]
    fn revoking_removes_only_that_binding_and_notifies() {
        let store = CredentialStore::in_memory(None, None);
        let a = store
            .create_pending("a".into(), BindingClient::default())
            .unwrap();
        let b = store
            .create_pending("b".into(), BindingClient::default())
            .unwrap();
        let mut rx = store.subscribe();
        assert!(store.revoke(&a.id).unwrap());
        assert!(!store.revoke(&a.id).unwrap());
        assert_eq!(rx.try_recv().unwrap(), a.id);
        assert!(store.authenticate(&a.transport_key).is_none());
        assert!(store.authenticate(&a.control_key).is_none());
        assert!(store.authenticate(&b.transport_key).is_some());
    }

    #[test]
    fn deployment_keys_are_principals_without_a_binding() {
        let store = CredentialStore::in_memory(Some("t".repeat(40)), Some("c".repeat(40)));
        assert_eq!(
            store.authenticate(&"t".repeat(40)),
            Some(Principal {
                binding_id: None,
                role: Role::Transport
            })
        );
        assert_eq!(
            store.authenticate(&"c".repeat(40)).unwrap().role,
            Role::Control
        );
        assert!(store.list().is_empty());
    }

    #[test]
    fn legacy_password_is_imported_once_and_keeps_both_keys_valid() {
        let dir = temp_dir("legacy");
        let legacy = dir.join("auth-key");
        let password = "a".repeat(64);
        std::fs::write(&legacy, format!("{password}\n")).unwrap();

        let store = CredentialStore::open(dir.clone(), Some(&legacy), None, None).unwrap();
        let bindings = store.list();
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].source, BindingSource::LegacyPassword);
        assert_eq!(store.authenticate(&password).unwrap().role, Role::Transport);
        let control = legacy_control_key(&password);
        assert_eq!(
            control,
            // HMAC-SHA256("a"*64, "nuphos-runtime-control-v1"), as the backend derives it.
            {
                use hmac::{Hmac, Mac};
                let mut mac = Hmac::<Sha256>::new_from_slice(password.as_bytes()).unwrap();
                mac.update(b"nuphos-runtime-control-v1");
                hex(&mac.finalize().into_bytes())
            }
        );
        assert_eq!(store.authenticate(&control).unwrap().role, Role::Control);

        assert!(store.revoke(LEGACY_BINDING_ID).unwrap());
        let reopened = CredentialStore::open(dir.clone(), Some(&legacy), None, None).unwrap();
        assert!(
            reopened.list().is_empty(),
            "a revoked legacy binding stays revoked"
        );
        assert!(reopened.authenticate(&password).is_none());
    }

    #[test]
    fn bindings_persist_without_plaintext_keys() {
        let dir = temp_dir("persist");
        let store = CredentialStore::open(dir.clone(), None, None, None).unwrap();
        let issued = store
            .create_pending(
                "Team".into(),
                BindingClient {
                    team_name: Some("Acme".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let raw = std::fs::read_to_string(dir.join(BINDINGS_FILE)).unwrap();
        assert!(!raw.contains(&issued.transport_key));
        assert!(!raw.contains(&issued.control_key));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(BINDINGS_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let reopened = CredentialStore::open(dir, None, None, None).unwrap();
        let binding = reopened.get(&issued.id).unwrap();
        assert_eq!(binding.client.team_name.as_deref(), Some("Acme"));
        assert!(reopened.authenticate(&issued.transport_key).is_some());
    }

    #[cfg(unix)]
    #[test]
    fn a_revoke_that_cannot_be_written_is_undone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("readonly");
        let store = CredentialStore::open(dir.clone(), None, None, None).unwrap();
        let issued = store
            .create_pending("a".into(), BindingClient::default())
            .unwrap();
        let mut rx = store.subscribe();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();

        let revoked = store.revoke(&issued.id);
        let created = store.create_pending("b".into(), BindingClient::default());
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();

        assert!(revoked.is_err());
        assert!(created.is_err());
        assert!(
            rx.try_recv().is_err(),
            "no socket is closed for a revoke that did not happen"
        );
        assert!(store.authenticate(&issued.transport_key).is_some());
        assert_eq!(store.list().len(), 1);
        let reopened = CredentialStore::open(dir, None, None, None).unwrap();
        assert!(reopened.contains(&issued.id));
        assert_eq!(reopened.list().len(), 1);
    }

    #[test]
    fn the_instance_id_survives_a_restart() {
        let dir = temp_dir("instance");
        let first = CredentialStore::open(dir.clone(), None, None, None).unwrap();
        let second = CredentialStore::open(dir, None, None, None).unwrap();
        assert_eq!(first.instance_id(), second.instance_id());
        assert!(uuid::Uuid::parse_str(first.instance_id()).is_ok());
    }

    #[test]
    fn a_corrupt_bindings_file_is_an_error_not_an_empty_store() {
        let dir = temp_dir("corrupt");
        std::fs::write(dir.join(BINDINGS_FILE), "not json").unwrap();
        assert!(CredentialStore::open(dir, None, None, None).is_err());
    }
}
