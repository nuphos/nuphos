//! Regression coverage for pool-wide admission while ACP sessions initialize.

use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::Mutex;

const BLOCKING_AGENT: &str = r##"#!/bin/sh
printf 'spawn\n' >> "$COUNT_FILE"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      while [ ! -f "$RELEASE_FILE" ]; do sleep 0.01; done
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake_%s"}}\n' "$id" "$$"
      ;;
  esac
done
"##;

const FAIL_ONCE_AGENT: &str = r##"#!/bin/sh
printf 'spawn\n' >> "$COUNT_FILE"
spawn_number=$(wc -l < "$COUNT_FILE" | tr -d ' ')
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      if [ "$spawn_number" = 1 ]; then exit 1; fi
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake_%s"}}\n' "$id" "$$"
      ;;
  esac
done
"##;

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn write_agent(path: &std::path::Path, contents: &str) {
    std::fs::write(path, contents).expect("write fake agent");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .expect("make fake agent executable");
    }
}

fn pool_for_agent(
    tmp: &tempfile::TempDir,
    script: &std::path::Path,
    count_file: &std::path::Path,
    release_file: Option<&std::path::Path>,
) -> Arc<SessionPool> {
    let mut env = HashMap::from([(
        "COUNT_FILE".to_string(),
        count_file.to_string_lossy().into_owned(),
    )]);
    if let Some(release_file) = release_file {
        env.insert(
            "RELEASE_FILE".to_string(),
            release_file.to_string_lossy().into_owned(),
        );
    }
    let config = AgentConfig {
        command: script.to_string_lossy().into_owned(),
        args: vec![],
        working_dir: tmp.path().to_string_lossy().into_owned(),
        env,
        inherit_env: vec![],
        command_explicit: true,
    };
    Arc::new(SessionPool::new(config, 1, 60, HashMap::new()))
}

fn spawn_count(path: &std::path::Path) -> usize {
    std::fs::read_to_string(path)
        .map(|content| content.lines().count())
        .unwrap_or_default()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_initialization_reserves_capacity_before_spawning() {
    let _env_guard = env_lock().lock().await;
    let tmp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("HOME", tmp.path());

    let script = tmp.path().join("blocking_agent.sh");
    let count_file = tmp.path().join("spawns.log");
    let release_file = tmp.path().join("release");
    write_agent(&script, BLOCKING_AGENT);
    let pool = pool_for_agent(&tmp, &script, &count_file, Some(&release_file));

    let first_pool = Arc::clone(&pool);
    let first =
        tokio::spawn(async move { first_pool.get_or_create("acp:first", None, &[], None).await });

    tokio::time::timeout(Duration::from_secs(2), async {
        while spawn_count(&count_file) < 1 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the first agent should spawn");

    let second_pool = Arc::clone(&pool);
    let mut second = tokio::spawn(async move {
        second_pool
            .get_or_create("acp:second", None, &[], None)
            .await
    });

    let early_second = tokio::time::timeout(Duration::from_secs(1), &mut second).await;
    let second_completed_early = early_second.is_ok();
    let count_before_release = spawn_count(&count_file);
    std::fs::write(&release_file, b"go").expect("release fake agents");

    let first_result = tokio::time::timeout(Duration::from_secs(5), first)
        .await
        .expect("first creation should finish")
        .expect("first task should not panic");

    let second_result = match early_second {
        Ok(result) => result.expect("second task should not panic"),
        Err(_) => tokio::time::timeout(Duration::from_secs(5), second)
            .await
            .expect("late second creation should finish after release")
            .expect("second task should not panic"),
    };

    assert!(
        first_result.is_ok(),
        "the admitted creation should succeed: {first_result:?}"
    );
    assert_eq!(
        count_before_release, 1,
        "max_sessions=1 must allow only one agent process to initialize"
    );
    let error = second_result.expect_err("the second creation must be rejected at admission");
    assert!(
        error.to_string().contains("pool exhausted (1 sessions)"),
        "unexpected admission error: {error:#}"
    );
    assert!(
        second_completed_early,
        "the second creation waited for agent initialization instead of failing fast"
    );
}

#[tokio::test]
async fn failed_initialization_releases_reserved_capacity() {
    let _env_guard = env_lock().lock().await;
    let tmp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("HOME", tmp.path());

    let script = tmp.path().join("fail_once_agent.sh");
    let count_file = tmp.path().join("spawns.log");
    write_agent(&script, FAIL_ONCE_AGENT);
    let pool = pool_for_agent(&tmp, &script, &count_file, None);

    let first = pool.get_or_create("acp:first", None, &[], None).await;
    assert!(
        first.is_err(),
        "the fake agent's first initialization must fail"
    );

    let second = tokio::time::timeout(
        Duration::from_secs(5),
        pool.get_or_create("acp:second", None, &[], None),
    )
    .await
    .expect("the replacement creation should finish");
    assert!(
        second.is_ok(),
        "released capacity should admit a replacement: {second:?}"
    );
    assert_eq!(spawn_count(&count_file), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_initialization_releases_reserved_capacity() {
    let _env_guard = env_lock().lock().await;
    let tmp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("HOME", tmp.path());

    let script = tmp.path().join("blocking_agent.sh");
    let count_file = tmp.path().join("spawns.log");
    let release_file = tmp.path().join("release");
    write_agent(&script, BLOCKING_AGENT);
    let pool = pool_for_agent(&tmp, &script, &count_file, Some(&release_file));

    let first_pool = Arc::clone(&pool);
    let first =
        tokio::spawn(async move { first_pool.get_or_create("acp:first", None, &[], None).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while spawn_count(&count_file) < 1 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the cancelled agent should have started initializing");

    first.abort();
    let cancelled = first
        .await
        .expect_err("the first creation should be cancelled");
    assert!(cancelled.is_cancelled());

    let second_pool = Arc::clone(&pool);
    let second = tokio::spawn(async move {
        second_pool
            .get_or_create("acp:second", None, &[], None)
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while spawn_count(&count_file) < 2 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("released capacity should let the replacement agent spawn");
    std::fs::write(&release_file, b"go").expect("release replacement agent");

    let second = tokio::time::timeout(Duration::from_secs(5), second)
        .await
        .expect("the replacement creation should finish")
        .expect("the replacement task should not panic");
    assert!(
        second.is_ok(),
        "the replacement should initialize: {second:?}"
    );
}
