//! Which runtime binding owns each ACP session, so one binding can neither see nor act on
//! another binding's sessions. Persisted as `session-owners.json` beside `bindings.json`:
//! otherwise, after a restart, the first binding to resume a session would own it.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tracing::error;

use super::runtime_credentials::write_private_atomic;

const OWNERS_FILE: &str = "session-owners.json";
/// Beyond this a binding's oldest claim not in use is dropped, so a binding cannot grow the
/// ledger without bound by resuming made-up session ids.
pub const MAX_SESSIONS_PER_BINDING: usize = 4096;
/// A fresh claim is never evicted before its connection has had time to attach it.
const CLAIM_GRACE: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq, Eq)]
pub enum Claim {
    Owned,
    Foreign,
    /// The binding is at its cap and every one of its sessions is in use.
    Full,
}

#[derive(Serialize, Deserialize)]
struct Entry {
    session: String,
    binding: String,
}

#[derive(Default)]
struct Ledger {
    owners: HashMap<String, String>,
    /// Each binding's channels and when they were claimed, oldest claim first.
    claims: HashMap<String, VecDeque<(String, Instant)>>,
}

/// A claim that can be undone when it cannot be written.
struct Inserted {
    binding: String,
    evicted: Option<(usize, (String, Instant))>,
}

impl Ledger {
    /// `None` when the binding is at `cap` and every one of its sessions is in use.
    fn insert(
        &mut self,
        channel: String,
        binding: String,
        cap: usize,
        evictable: impl Fn(&str, Instant) -> bool,
    ) -> Option<Inserted> {
        let claims = self.claims.entry(binding.clone()).or_default();
        let mut evicted = None;
        if claims.len() >= cap {
            let index = claims.iter().position(|(c, at)| evictable(c, *at))?;
            let old = claims.remove(index)?;
            self.owners.remove(&old.0);
            evicted = Some((index, old));
        }
        claims.push_back((channel.clone(), Instant::now()));
        self.owners.insert(channel, binding.clone());
        Some(Inserted { binding, evicted })
    }

    fn undo(&mut self, channel: &str, inserted: Inserted) {
        self.owners.remove(channel);
        if let Some(claims) = self.claims.get_mut(&inserted.binding) {
            claims.pop_back();
            if let Some((index, old)) = inserted.evicted {
                self.owners.insert(old.0.clone(), inserted.binding);
                claims.insert(index, old);
            }
        }
    }

    fn entries(&self) -> Vec<Entry> {
        self.claims
            .iter()
            .flat_map(|(binding, channels)| {
                channels.iter().map(|(channel, _)| Entry {
                    session: channel.clone(),
                    binding: binding.clone(),
                })
            })
            .collect()
    }
}

pub struct SessionOwners {
    path: Option<PathBuf>,
    cap: usize,
    grace: Duration,
    ledger: Mutex<Ledger>,
}

impl Default for SessionOwners {
    fn default() -> Self {
        Self {
            path: None,
            cap: MAX_SESSIONS_PER_BINDING,
            grace: CLAIM_GRACE,
            ledger: Mutex::default(),
        }
    }
}

impl SessionOwners {
    /// A corrupt file is an error: starting empty would let any binding claim every session.
    pub fn open(dir: &Path) -> anyhow::Result<Self> {
        let path = dir.join(OWNERS_FILE);
        let entries: Vec<Entry> = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        let mut ledger = Ledger::default();
        for entry in entries {
            if !ledger.owners.contains_key(&entry.session) {
                ledger.insert(entry.session, entry.binding, usize::MAX, |_, _| false);
            }
        }
        Ok(Self {
            path: Some(path),
            ledger: Mutex::new(ledger),
            ..Self::default()
        })
    }

    #[cfg(test)]
    pub fn with_limits(mut self, cap: usize, grace: Duration) -> Self {
        self.cap = cap;
        self.grace = grace;
        self
    }

    #[cfg(test)]
    pub fn claimed_count(&self) -> usize {
        self.ledger.lock().owners.len()
    }

    pub fn owner(&self, channel: &str) -> Option<String> {
        self.ledger.lock().owners.get(channel).cloned()
    }

    /// Records `binding` as the owner of an unowned channel. At the cap, the binding's oldest
    /// claim that is past its grace period and not `in_use` makes room. A claim that cannot
    /// be written is undone: after a restart it would belong to whoever resumed first.
    pub fn claim(
        &self,
        channel: &str,
        binding: &str,
        in_use: impl Fn(&str) -> bool,
    ) -> std::io::Result<Claim> {
        let mut ledger = self.ledger.lock();
        if let Some(existing) = ledger.owners.get(channel) {
            return Ok(if existing == binding {
                Claim::Owned
            } else {
                Claim::Foreign
            });
        }
        let evictable = |c: &str, at: Instant| at.elapsed() >= self.grace && !in_use(c);
        let Some(inserted) =
            ledger.insert(channel.to_string(), binding.to_string(), self.cap, evictable)
        else {
            return Ok(Claim::Full);
        };
        if let Err(e) = self.save(&ledger) {
            ledger.undo(channel, inserted);
            error!(error = %e, "runtime credentials: could not write session owners; claim undone");
            return Err(e);
        }
        Ok(Claim::Owned)
    }

    /// A revoked binding's sessions become unowned, so the application can resume them after
    /// pairing again.
    pub fn release_binding(&self, binding: &str) {
        let mut ledger = self.ledger.lock();
        let Some(channels) = ledger.claims.remove(binding) else {
            return;
        };
        for (channel, _) in channels {
            ledger.owners.remove(&channel);
        }
        if let Err(e) = self.save(&ledger) {
            error!(error = %e, "runtime credentials: could not write session owners");
        }
    }

    fn save(&self, ledger: &Ledger) -> std::io::Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let json = serde_json::to_vec(&ledger.entries()).map_err(std::io::Error::other)?;
        write_private_atomic(path, &json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openab-owners-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_first_claim_wins_and_survives_a_restart() {
        let dir = temp_dir();
        let owners = SessionOwners::open(&dir).unwrap();
        assert_eq!(owners.claim("acp_1", "a", idle).unwrap(), Claim::Owned);
        assert_eq!(owners.claim("acp_1", "a", idle).unwrap(), Claim::Owned);
        assert_eq!(owners.claim("acp_1", "b", idle).unwrap(), Claim::Foreign);

        let reopened = SessionOwners::open(&dir).unwrap();
        assert_eq!(reopened.owner("acp_1").as_deref(), Some("a"));
        assert_eq!(reopened.claim("acp_1", "b", idle).unwrap(), Claim::Foreign);

        reopened.release_binding("a");
        let after_revoke = SessionOwners::open(&dir).unwrap();
        assert_eq!(after_revoke.claim("acp_1", "b", idle).unwrap(), Claim::Owned);
        let _ = std::fs::remove_dir_all(dir);
    }

    fn idle(_: &str) -> bool {
        false
    }

    #[test]
    fn a_binding_cannot_grow_the_ledger_past_its_cap() {
        let owners = SessionOwners::default().with_limits(3, Duration::ZERO);
        assert_eq!(owners.claim("keep", "b", idle).unwrap(), Claim::Owned);
        for n in 0..10 {
            let claimed = owners.claim(&format!("acp_{n}"), "a", idle).unwrap();
            assert_eq!(claimed, Claim::Owned);
        }
        let ledger = owners.ledger.lock();
        assert_eq!(ledger.claims["a"].len(), 3);
        assert_eq!(ledger.owners.len(), 4);
        assert_eq!(ledger.owners.get("keep").map(String::as_str), Some("b"));
        assert_eq!(ledger.owners.get("acp_9").map(String::as_str), Some("a"));
        assert!(!ledger.owners.contains_key("acp_0"));
    }

    #[test]
    fn eviction_skips_sessions_in_use_and_refuses_when_all_are() {
        let owners = SessionOwners::default().with_limits(2, Duration::ZERO);
        let live = |c: &str| c == "live";
        assert_eq!(owners.claim("live", "a", live).unwrap(), Claim::Owned);
        assert_eq!(owners.claim("old", "a", live).unwrap(), Claim::Owned);
        assert_eq!(owners.claim("new", "a", live).unwrap(), Claim::Owned);
        assert_eq!(owners.owner("live").as_deref(), Some("a"));
        assert_eq!(owners.owner("old"), None);
        assert_eq!(owners.claim("more", "a", |_| true).unwrap(), Claim::Full);
        assert_eq!(owners.owner("more"), None);
    }

    #[test]
    fn a_fresh_claim_is_not_evicted_before_it_can_be_attached() {
        let owners = SessionOwners::default().with_limits(1, Duration::from_secs(60));
        assert_eq!(owners.claim("resuming", "a", idle).unwrap(), Claim::Owned);
        assert_eq!(owners.claim("other", "a", idle).unwrap(), Claim::Full);
        assert_eq!(owners.owner("resuming").as_deref(), Some("a"));
    }

    #[test]
    fn a_claim_that_cannot_be_written_is_undone() {
        let dir = temp_dir();
        let owners = SessionOwners::open(&dir)
            .unwrap()
            .with_limits(1, Duration::ZERO);
        assert_eq!(owners.claim("first", "a", idle).unwrap(), Claim::Owned);
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::write(&dir, b"not a directory").unwrap();

        assert!(owners.claim("second", "a", idle).is_err());
        assert_eq!(owners.owner("second"), None);
        assert_eq!(owners.owner("first").as_deref(), Some("a"));
        assert_eq!(owners.ledger.lock().claims["a"].len(), 1);
        let _ = std::fs::remove_file(dir);
    }

    #[test]
    fn a_corrupt_file_refuses_to_open() {
        let dir = temp_dir();
        std::fs::write(dir.join(OWNERS_FILE), b"{not json").unwrap();
        assert!(SessionOwners::open(&dir).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
