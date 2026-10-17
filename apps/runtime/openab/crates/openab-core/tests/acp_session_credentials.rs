//! A prompt's session `_meta` refreshes a live agent's credential files and the
//! meta a respawn replays, without restarting the agent.
#![cfg(unix)]
use openab_core::acp::session_credentials::session_credentials_dir;
use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;

#[tokio::test]
async fn prompt_meta_refreshes_live_and_respawned_credentials() {
    let tmp = tempfile::tempdir().unwrap();
    // This integration-test binary contains one test; isolate pool persistence.
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    let record = tmp.path().join("calls");
    let spawned = tmp.path().join("spawned");
    std::fs::write(
        &script,
        r##"#!/bin/sh
printf '%s %s\n' "$$" "$OPENAB_CREDENTIALS_DIR" >> "$SPAWNED"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$RECORD"
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
    let pool = SessionPool::new(config, 4, 60, HashMap::new());
    let meta = |token: &str| json!({"dev.openab/credentials": {"NUPHOS_TOKEN": token}});
    let dir = session_credentials_dir(&tmp.path().join(".openab/credentials"), "acp:c");
    let token = || std::fs::read_to_string(dir.join("NUPHOS_TOKEN")).unwrap();
    let spawns = || {
        std::fs::read_to_string(&spawned)
            .unwrap()
            .lines()
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };

    pool.get_or_create("acp:c", None, &[], Some(&meta("first")))
        .await
        .unwrap();
    assert_eq!(token(), "first");
    let first = spawns();
    assert_eq!(first.len(), 1);
    let (pid, env_dir) = first[0].split_once(' ').unwrap();
    assert_eq!(env_dir, dir.to_string_lossy());

    pool.get_or_create("acp:c", None, &[], Some(&meta("second")))
        .await
        .unwrap();
    assert_eq!(token(), "second");
    assert_eq!(spawns().len(), 1, "a live agent must not be restarted");

    std::process::Command::new("kill")
        .arg(pid)
        .status()
        .unwrap();
    for _ in 0..100 {
        if pool.get_or_create("acp:c", None, &[], None).await.is_ok() && spawns().len() == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(spawns().len(), 2, "the dead agent must be respawned");
    let calls = std::fs::read_to_string(&record).unwrap();
    let load = calls
        .lines()
        .find(|line| line.contains("\"session/load\""))
        .expect("respawn resumes the saved session");
    assert!(load.contains("\"NUPHOS_TOKEN\":\"second\""), "{load}");
    assert_eq!(token(), "second");
}
