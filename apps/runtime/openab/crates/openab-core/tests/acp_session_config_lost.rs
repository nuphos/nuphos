//! A setting sent to an agent that lost its session restores the session once and is
//! sent again, as a prompt is; any other rejection, or a second loss, fails as before.
#![cfg(unix)]
use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use std::collections::HashMap;
use std::sync::Arc;

/// Answers the next `$GONE` settings with ACP "resource not found", as
/// claude-agent-acp does for a session it no longer holds.
const AGENT: &str = r##"#!/bin/sh
options='[{"id":"model","name":"Model","type":"select","currentValue":"a","options":[{"name":"A","value":"a"},{"name":"B","value":"b"},{"name":"Reject","value":"reject"}]}]'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) result='{"agentInfo":{"name":"fixture"},"agentCapabilities":{"loadSession":true}}';;
    *'"session/new"'*) result="{\"sessionId\":\"inner\",\"configOptions\":$options}";;
    *'"session/load"'*) echo load >> "$RECORD"; result="{\"configOptions\":$options}";;
    *'"session/set_config_option"'*)
      echo set >> "$RECORD"
      gone=$(cat "$GONE" 2>/dev/null || echo 0)
      if [ "$gone" -gt 0 ]; then
        echo $((gone - 1)) > "$GONE"
        if [ -e "$INTERNAL" ]; then
          printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"Internal error","data":{"details":"Session not found"}}}\n' "$id"; continue
        fi
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32002,"message":"Resource not found"}}\n' "$id"; continue
      fi
      case "$line" in *'"value":"reject"'*) printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32602,"message":"rejected"}}\n' "$id"; continue;; esac
      result='{"configOptions":[{"id":"model","name":"Model","type":"select","currentValue":"b","options":[{"name":"A","value":"a"},{"name":"B","value":"b"},{"name":"Reject","value":"reject"}]}]}';;
    *) result='{}';;
  esac
  printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$result"
done
"##;

#[tokio::test]
async fn a_setting_restores_a_lost_session_once() {
    let tmp = tempfile::tempdir().unwrap();
    // This integration-test binary contains one test; isolate pool persistence.
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    let record = tmp.path().join("calls");
    let gone = tmp.path().join("gone");
    let internal = tmp.path().join("internal");
    std::fs::write(&script, AGENT).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let config = AgentConfig {
        command: script.to_string_lossy().into(),
        args: vec![],
        working_dir: tmp.path().to_string_lossy().into(),
        env: HashMap::from([
            ("RECORD".into(), record.to_string_lossy().into()),
            ("GONE".into(), gone.to_string_lossy().into()),
            ("INTERNAL".into(), internal.to_string_lossy().into()),
        ]),
        inherit_env: vec![],
        command_explicit: true,
    };
    let pool = Arc::new(SessionPool::new(config, 4, 60, HashMap::new()));
    pool.get_or_create("t", None, &[], None).await.unwrap();
    let calls = || {
        let calls = std::fs::read_to_string(&record).unwrap_or_default();
        std::fs::remove_file(&record).ok();
        calls.lines().map(str::to_owned).collect::<Vec<_>>()
    };

    // Lost once: restored with session/load, then the setting applies.
    std::fs::write(&gone, "1").unwrap();
    let value = pool
        .session_config_options("t", Some(("model", "b")))
        .await
        .unwrap();
    assert_eq!(value["configOptions"][0]["currentValue"], "b");
    assert_eq!(calls(), ["set", "load", "set"]);

    // Lost again on the retry: one restore only, then the usual failure.
    std::fs::write(&gone, "2").unwrap();
    let err = pool
        .session_config_options("t", Some(("model", "b")))
        .await
        .unwrap_err();
    assert_eq!(err.0, -32603);
    assert_eq!(calls(), ["set", "load", "set"]);

    // claude-agent-acp's plain "Session not found", relayed as -32603, is the same loss.
    std::fs::write(&internal, "").unwrap();
    std::fs::write(&gone, "1").unwrap();
    let value = pool
        .session_config_options("t", Some(("model", "b")))
        .await
        .unwrap();
    assert_eq!(value["configOptions"][0]["currentValue"], "b");
    assert_eq!(calls(), ["set", "load", "set"]);
    std::fs::remove_file(&internal).unwrap();

    // Any other rejection is the agent's answer, not a lost session.
    std::fs::write(&gone, "0").unwrap();
    let err = pool
        .session_config_options("t", Some(("model", "reject")))
        .await
        .unwrap_err();
    assert_eq!(err.0, -32603);
    assert_eq!(calls(), ["set"]);
}
