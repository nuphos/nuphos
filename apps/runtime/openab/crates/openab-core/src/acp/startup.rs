use crate::acp::connection::AcpConnection;
use anyhow::Result;
use rand::Rng;
use std::collections::HashMap;
use std::time::Duration;
use tracing::warn;

/// codex app-server exits at startup when another Codex process in the same HOME holds the
/// write lock on its sqlite state for longer than Codex's own 5s busy timeout.
const LOCKED_STATE_SIGNATURE: &str = "failed to initialize sqlite state runtime";

pub(crate) const LOCKED_STATE_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(12),
];

pub(crate) struct AgentCommand<'a> {
    pub command: &'a str,
    pub args: &'a [String],
    pub working_dir: &'a str,
    pub env: &'a HashMap<String, String>,
    pub inherit_env: &'a [String],
}

/// Spawn the agent and complete the ACP handshake, respawning a fresh process when the agent
/// reports that its state store is locked by a sibling. Any other failure returns immediately.
/// A failed attempt's connection is dropped before the backoff, which kills its process group.
pub(crate) async fn spawn_initialized(
    agent: &AgentCommand<'_>,
    retry_delays: &[Duration],
) -> Result<AcpConnection> {
    let mut attempt = 1;
    loop {
        let err = match spawn_and_initialize(agent).await {
            Ok(conn) => return Ok(conn),
            Err(err) => err,
        };
        let Some(base) = retry_delays.get(attempt - 1) else {
            return Err(err);
        };
        if !is_locked_state(&err) {
            return Err(err);
        }
        let delay = jittered(*base);
        warn!(
            attempt,
            max_attempts = retry_delays.len() + 1,
            delay_ms = delay.as_millis() as u64,
            error = %err,
            "agent state store is locked by another process, respawning after backoff"
        );
        tokio::time::sleep(delay).await;
        attempt += 1;
    }
}

async fn spawn_and_initialize(agent: &AgentCommand<'_>) -> Result<AcpConnection> {
    let mut conn = AcpConnection::spawn(
        agent.command,
        agent.args,
        agent.working_dir,
        agent.env,
        agent.inherit_env,
    )
    .await?;
    conn.initialize().await?;
    Ok(conn)
}

fn is_locked_state(err: &anyhow::Error) -> bool {
    format!("{err:#}").contains(LOCKED_STATE_SIGNATURE)
}

fn jittered(base: Duration) -> Duration {
    base.mul_f64(rand::thread_rng().gen_range(0.75..1.25))
}

#[cfg(all(test, unix))]
mod tests {
    use super::{spawn_initialized, AgentCommand};
    use std::collections::HashMap;
    use std::time::Duration;

    const LOCKED_ERROR: &str = "Codex process has exited with code 1: Error: failed to initialize sqlite state runtime under /home/node/.codex: failed to initialize state runtime at /home/node/.codex";

    const FLAKY_AGENT: &str = r##"#!/bin/sh
sleep 60 &
printf '%s\n' "$!" >> "$SPAWN_LOG"
spawn_number=$(wc -l < "$SPAWN_LOG" | tr -d ' ')
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      if [ "$spawn_number" -le "$FAILURES" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":1001,"message":"%s"}}\n' "$id" "$INIT_ERROR"
      else
        printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{"loadSession":true}}}\n' "$id"
      fi
      ;;
  esac
done
"##;

    struct Fixture {
        _dir: tempfile::TempDir,
        script: String,
        spawn_log: std::path::PathBuf,
        working_dir: String,
        env: HashMap<String, String>,
    }

    impl Fixture {
        fn new(failures: usize, init_error: &str) -> Self {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempfile::tempdir().unwrap();
            let script = dir.path().join("agent.sh");
            std::fs::write(&script, FLAKY_AGENT).unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            let spawn_log = dir.path().join("spawns.log");
            let env = HashMap::from([
                ("SPAWN_LOG".to_string(), spawn_log.display().to_string()),
                ("FAILURES".to_string(), failures.to_string()),
                ("INIT_ERROR".to_string(), init_error.to_string()),
            ]);
            Self {
                script: script.display().to_string(),
                working_dir: dir.path().display().to_string(),
                spawn_log,
                env,
                _dir: dir,
            }
        }

        fn agent(&self) -> AgentCommand<'_> {
            AgentCommand {
                command: &self.script,
                args: &[],
                working_dir: &self.working_dir,
                env: &self.env,
                inherit_env: &[],
            }
        }

        fn helper_pids(&self) -> Vec<i32> {
            std::fs::read_to_string(&self.spawn_log)
                .unwrap_or_default()
                .lines()
                .map(|pid| pid.trim().parse().unwrap())
                .collect()
        }
    }

    const FAST: [Duration; 3] = [Duration::from_millis(20); 3];

    async fn assert_gone(pid: i32) {
        for _ in 0..100 {
            if unsafe { libc::kill(pid, 0) } != 0 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("process {pid} from a failed attempt is still running");
    }

    #[tokio::test]
    async fn respawns_until_the_locked_state_store_is_released() {
        let fixture = Fixture::new(2, LOCKED_ERROR);

        let conn = spawn_initialized(&fixture.agent(), &FAST)
            .await
            .expect("the third attempt should initialize");

        assert!(conn.alive());
        assert!(conn.supports_load_session);
        let pids = fixture.helper_pids();
        assert_eq!(pids.len(), 3);
        for pid in &pids[..2] {
            assert_gone(*pid).await;
        }
        assert_eq!(unsafe { libc::kill(pids[2], 0) }, 0);
    }

    #[tokio::test]
    async fn gives_up_after_the_last_backoff() {
        let fixture = Fixture::new(1000, LOCKED_ERROR);

        let Err(err) = spawn_initialized(&fixture.agent(), &FAST).await else {
            panic!("a store that stays locked must surface the error");
        };

        assert!(format!("{err:#}").contains("failed to initialize sqlite state runtime"));
        let pids = fixture.helper_pids();
        assert_eq!(pids.len(), FAST.len() + 1);
        for pid in pids {
            assert_gone(pid).await;
        }
    }

    #[tokio::test]
    async fn other_initialize_failures_are_not_retried() {
        let fixture = Fixture::new(
            1000,
            "Codex process has exited with code 1: Error: invalid config.toml",
        );

        let Err(err) = spawn_initialized(&fixture.agent(), &FAST).await else {
            panic!("an unrelated failure must surface");
        };

        assert!(format!("{err:#}").contains("invalid config.toml"));
        assert_eq!(fixture.helper_pids().len(), 1);
    }
}
