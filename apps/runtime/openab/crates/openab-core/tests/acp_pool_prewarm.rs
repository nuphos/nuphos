//! `[pool] prewarm` (#5158): the next session takes an agent started before it, and
//! that session/new carries the spawn env the agent missed under `ai.nuphos/spawnEnv`.
#![cfg(unix)]
use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;

#[tokio::test]
async fn the_next_session_takes_the_warmed_agent() {
    let tmp = tempfile::tempdir().unwrap();
    // This integration-test binary contains one test; isolate pool persistence.
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    let record = tmp.path().join("calls");
    let spawned = tmp.path().join("spawned");
    std::fs::write(
        &script,
        r##"#!/bin/sh
printf '%s %s\n' "$$" "$NUPHOS_PREWARM" >> "$SPAWNED"
while IFS= read -r line; do
  printf '%s %s\n' "$$" "$line" >> "$RECORD"
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) result='{"agentInfo":{"name":"fixture"},"agentCapabilities":{"loadSession":true}}';;
    *'"session/new"'*) result='{"sessionId":"inner"}';;
    *) result='{}';;
  esac
  printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$result"
done
"##,
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let config = AgentConfig {
        command: script.to_string_lossy().into(),
        args: vec![],
        working_dir: tmp.path().to_string_lossy().into(),
        env: HashMap::from([
            ("RECORD".into(), record.to_string_lossy().into()),
            ("SPAWNED".into(), spawned.to_string_lossy().into()),
        ]),
        inherit_env: vec![],
        command_explicit: true,
    };
    let spawns = || {
        std::fs::read_to_string(&spawned)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    let until = |count: usize| {
        let spawns = &spawns;
        async move {
            for _ in 0..100 {
                if spawns().len() >= count {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            panic!("expected {count} agents, saw {:?}", spawns());
        }
    };
    let pool = SessionPool::new(config, 4, 60, HashMap::new()).with_prewarm(true);
    until(1).await;
    // Let the spare's initialize finish so the session finds it ready.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let warmed = spawns()[0].clone();
    assert!(
        warmed.ends_with(" 1"),
        "the spare runs with NUPHOS_PREWARM=1: {warmed}"
    );

    let meta = json!({"dev.openab/credentials": {"NUPHOS_TOKEN": "t"}});
    pool.get_or_create("acp:c", None, &[], Some(&meta))
        .await
        .unwrap();
    let calls = std::fs::read_to_string(&record).unwrap();
    let session_new = calls
        .lines()
        .find(|line| line.contains("\"session/new\""))
        .expect("session/new");
    let (pid, session_new) = session_new.split_once(' ').unwrap();
    assert_eq!(
        Some(pid),
        warmed.split(' ').next(),
        "the session took the spare"
    );
    let request: serde_json::Value = serde_json::from_str(session_new).unwrap();
    let spawn_env = &request["params"]["_meta"]["ai.nuphos/spawnEnv"];
    assert!(
        spawn_env["OPENAB_CREDENTIALS_DIR"].is_string(),
        "the session's credentials dir reaches the warmed agent: {request}"
    );
    assert!(
        spawn_env.get("RECORD").is_none(),
        "only what the pool env lacks"
    );

    // Taking the spare starts the next one.
    until(2).await;
    assert_eq!(spawns().len(), 2);
    pool.shutdown().await;
}
