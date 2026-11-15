//! What a new session offers is read from an agent that never joins the pool.

use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

const SETTINGS_AGENT: &str = r##"#!/bin/sh
printf '%s\n' "$$" >> "$PID_FILE"
options() {
  printf '{"jsonrpc":"2.0","id":%s,"result":{%s"configOptions":[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"%s","options":[{"value":"fixture","name":"Fixture"},{"value":"other","name":"Other"}]}]}}\n' "$1" "$2" "$3"
}
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*) options "$id" '"sessionId":"sess_fake",' fixture ;;
    *'"session/set_config_option"'*'"other"'*) options "$id" '' other ;;
  esac
done
"##;

fn current_model(value: &Value) -> &str {
    value["configOptions"][0]["currentValue"]
        .as_str()
        .unwrap_or_default()
}

#[tokio::test]
async fn fresh_settings_come_from_an_agent_that_is_stopped_afterwards() {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    let pid_file = tmp.path().join("pids");
    std::fs::write(&script, SETTINGS_AGENT).expect("write fake agent");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let pool = SessionPool::new(
        AgentConfig {
            command: script.to_string_lossy().into_owned(),
            args: vec![],
            working_dir: tmp.path().to_string_lossy().into_owned(),
            env: HashMap::from([(
                "PID_FILE".to_string(),
                pid_file.to_string_lossy().into_owned(),
            )]),
            inherit_env: vec![],
            command_explicit: true,
        },
        1,
        60,
        HashMap::new(),
    );

    let fresh = pool.fresh_config_options(None).await.expect("defaults");
    assert_eq!(current_model(&fresh), "fixture");
    let chosen = pool
        .fresh_config_options(Some("other"))
        .await
        .expect("model");
    assert_eq!(current_model(&chosen), "other");
    let unknown = pool.fresh_config_options(Some("missing")).await;
    assert_eq!(unknown.map_err(|(code, _)| code), Err(-32602));

    assert!(pool.execution_session_keys().await.is_empty());
    tokio::time::sleep(Duration::from_millis(200)).await;
    let pids = std::fs::read_to_string(&pid_file).unwrap();
    assert_eq!(pids.lines().count(), 3);
    for pid in pids.lines() {
        let alive = std::process::Command::new("kill")
            .args(["-0", pid])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success();
        assert!(!alive, "agent {pid} outlived its read");
    }
}
