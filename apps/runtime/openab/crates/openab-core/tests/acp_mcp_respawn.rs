//! A live agent picks up a changed MCP declaration at its next turn.
//!
//! Agents read their MCP tool lists once, when the session opens. When a turn
//! declares different servers, the pool must respawn the idle agent and resume
//! the same session, but never while a turn is running, and never for a
//! declaration that only refreshed its per-turn headers.
#![cfg(unix)]
use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

fn tools(version: &str, token: &str) -> Vec<serde_json::Value> {
    vec![json!({
        "name": "nuphos-tools",
        "type": "http",
        "url": format!("https://api.example/mcp-tools?tools={version}"),
        "headers": [{"name": "Authorization", "value": format!("Bearer {token}")}],
    })]
}

#[tokio::test]
async fn a_changed_mcp_declaration_respawns_the_idle_agent_into_the_same_session() {
    let tmp = tempfile::tempdir().unwrap();
    // This integration-test binary owns its HOME; isolate pool persistence.
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    let record = tmp.path().join("calls");
    std::fs::write(&script, r##"#!/bin/sh
echo "spawn" >> "$RECORD"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) result='{"agentInfo":{"name":"fixture"},"agentCapabilities":{"loadSession":true}}';;
    *'"session/new"'*) echo "new" >> "$RECORD"; result='{"sessionId":"inner"}';;
    *'"session/load"'*) echo "load $line" >> "$RECORD"; result='{}';;
    *) result='{}';;
  esac
  [ -n "$id" ] && printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$result"
done
"##).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let pool = Arc::new(SessionPool::new(
        AgentConfig {
            command: script.to_string_lossy().into(),
            args: vec![],
            working_dir: tmp.path().to_string_lossy().into(),
            env: HashMap::from([("RECORD".into(), record.to_string_lossy().into())]),
            inherit_env: vec![],
            command_explicit: true,
        },
        4,
        60,
        HashMap::new(),
    ));
    let calls = || std::fs::read_to_string(&record).unwrap();

    assert!(pool
        .get_or_create("thread", None, &tools("a", "t1"), None)
        .await
        .unwrap());
    // A fresh per-turn token, or no declaration at all, is not a change.
    assert!(!pool
        .get_or_create("thread", None, &tools("a", "t2"), None)
        .await
        .unwrap());
    assert!(!pool.get_or_create("thread", None, &[], None).await.unwrap());
    assert_eq!(calls(), "spawn\nnew\n");

    // Mid-turn, the running agent is left alone.
    let (started, start) = tokio::sync::oneshot::channel();
    let (release, finish) = tokio::sync::oneshot::channel();
    let busy_pool = pool.clone();
    let busy = tokio::spawn(async move {
        busy_pool
            .with_connection("thread", |_conn| {
                Box::pin(async move {
                    started.send(()).unwrap();
                    finish.await.unwrap();
                    Ok(())
                })
            })
            .await
    });
    start.await.unwrap();
    assert!(!pool
        .get_or_create("thread", None, &tools("b", "t3"), None)
        .await
        .unwrap());
    release.send(()).unwrap();
    busy.await.unwrap().unwrap();
    assert_eq!(calls(), "spawn\nnew\n");

    // Between turns, a new agent resumes the same session with the new servers.
    assert!(!pool
        .get_or_create("thread", None, &tools("b", "t4"), None)
        .await
        .unwrap());
    let calls = calls();
    let lines: Vec<&str> = calls.lines().collect();
    assert_eq!(lines[..3], ["spawn", "new", "spawn"]);
    assert!(lines[3].starts_with("load ") && lines[3].contains(r#""sessionId":"inner""#));
    assert!(lines[3].contains("tools=b"));
    assert_eq!(lines.len(), 4);

    // The respawned agent now runs the current declaration.
    assert!(!pool
        .get_or_create("thread", None, &tools("b", "t5"), None)
        .await
        .unwrap());
    assert_eq!(std::fs::read_to_string(&record).unwrap().lines().count(), 4);
}
