//! The timer sweep must spare a session whose agent-initiated turn is still live
//! (NUPS-1237). Such a turn holds no connection lock and leaves `last_active`
//! frozen at the last client prompt, so age alone would reap it mid-turn.

use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use std::collections::HashMap;

const AGENT: &str = r##"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake_%s"}}\n' "$id" "$$"
      ;;
  esac
done
"##;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sweep_spares_live_agent_turns_and_reaps_idle_sessions() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    std::fs::write(&script, AGENT).expect("write fake agent");
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .expect("make fake agent executable");
    }
    let config = AgentConfig {
        command: script.to_string_lossy().into_owned(),
        args: vec![],
        working_dir: tmp.path().to_string_lossy().into_owned(),
        env: HashMap::new(),
        inherit_env: vec![],
        command_explicit: true,
    };
    let pool = SessionPool::new(config, 3, 60, HashMap::new());

    for key in ["acp:relaying", "acp:awaiting", "acp:idle"] {
        pool.get_or_create(key, None, &[], None)
            .await
            .expect("create session");
    }
    let activity = |key: &'static str| {
        let pool = &pool;
        async move {
            pool.with_connection(key, |conn| {
                Box::pin(async move { Ok(conn.activity_handle()) })
            })
            .await
            .expect("activity handle")
        }
    };
    activity("acp:relaying").await.mark_agent_relay();
    activity("acp:awaiting").await.begin_agent_permission_wait();

    // A zero TTL makes every session past the cutoff.
    pool.cleanup_idle(0).await;

    let connected = |key: &'static str| {
        let pool = &pool;
        async move {
            pool.with_connection(key, |_| Box::pin(async { Ok(()) }))
                .await
                .is_ok()
        }
    };
    assert!(
        connected("acp:relaying").await,
        "a relaying agent turn must survive the sweep"
    );
    assert!(
        connected("acp:awaiting").await,
        "a turn parked on a permission must survive the sweep"
    );
    assert!(
        !connected("acp:idle").await,
        "an idle session must be reaped"
    );
}
