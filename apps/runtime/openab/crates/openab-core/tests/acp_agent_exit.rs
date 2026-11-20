//! An agent that dies while starting leaves the person nothing to look at: the
//! process is gone and its stderr went nowhere else. The failure the host relays
//! must therefore carry how it ended and what it last said.
#![cfg(unix)]
use openab_core::acp::SessionPool;
use openab_core::config::AgentConfig;
use openab_core::error_display::format_user_error;
use std::collections::HashMap;

#[tokio::test]
async fn an_agent_that_exits_at_startup_reports_why() {
    let tmp = tempfile::tempdir().unwrap();
    // This integration-test binary owns its HOME; isolate pool persistence.
    std::env::set_var("HOME", tmp.path());
    let script = tmp.path().join("agent.sh");
    std::fs::write(
        &script,
        r##"#!/bin/sh
echo 'Error: dsh requires Node.js 24.9 or newer (found v20.19.0)' >&2
read line
exit 3
"##,
    )
    .unwrap();
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

    let Err(err) = pool.get_or_create("thread", None, &[], None).await else {
        panic!("an agent that exits cannot start a session");
    };
    let shown = format_user_error(&err);

    assert!(shown.contains("exit code 3"), "{shown}");
    assert!(shown.contains("requires Node.js 24.9 or newer"), "{shown}");
    assert!(shown.contains("Update Node.js"), "{shown}");
}
