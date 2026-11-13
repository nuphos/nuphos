//! A session/new rejection must reach the pool's caller as the agent's own error,
//! so an ACP host can relay its code and `data` (a sign-out, not a crash).
#![cfg(unix)]
use openab_core::acp::connection::AcpRequestError;
use openab_core::acp::pool::SessionStartError;
use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use std::collections::HashMap;

#[tokio::test]
async fn a_rejected_session_new_keeps_the_agents_code() {
    let tmp = tempfile::tempdir().unwrap();
    // This integration-test binary owns its HOME; isolate pool persistence.
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    std::fs::write(&script, r##"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32000,"message":"Authentication required"}}\n' "$id";;
    *) [ -n "$id" ] && printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id";;
  esac
done
"##).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let pool = SessionPool::new(
        AgentConfig {
            command: script.to_string_lossy().into(),
            args: vec![],
            working_dir: tmp.path().to_string_lossy().into(),
            env: HashMap::new(),
            inherit_env: vec![],
            command_explicit: true,
        },
        4,
        60,
        HashMap::new(),
    );

    match pool.get_or_create("thread", None, &[], None).await {
        Err(SessionStartError::Request(AcpRequestError::Agent(err))) => {
            assert_eq!(err.code, -32000)
        }
        other => panic!("expected the agent's error, got {other:?}"),
    }
}
