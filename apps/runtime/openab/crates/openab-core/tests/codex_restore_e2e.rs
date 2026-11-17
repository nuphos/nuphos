//! A real codex-acp session survives its agent being dropped and restored (#3371).
//!
//! The pool drops an agent's connection whenever it suspends a session (idle sweep, an agent
//! that lost its session, an MCP change) and restores it with `session/load` on the next
//! message. That load only works once the dropped agent's own Codex App Server has let go of
//! the thread: while it is still running, a new one answers "thread … already has an active
//! writer". On Windows nothing ended that process tree, so every restore failed.
//!
//! Runs only when `OPENAB_E2E_CODEX_ACP` (the patched adapter's `dist/index.js`) and
//! `OPENAB_E2E_CODEX` (the Codex CLI binary) are set, as the Windows runtime CI job does.
//! No model is reached: Codex talks to a local server that answers 401, which still records
//! the turn in the thread's rollout, so there is something to restore.
use openab_core::acp::{ContentBlock, SessionPool};
use openab_core::config::AgentConfig;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

/// Answer every request with a 401, the way the Responses API rejects a bad key.
fn spawn_unauthorized_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut buf = [0u8; 65536];
            let _ = stream.read(&mut buf);
            let body = r#"{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    port
}

#[tokio::test(flavor = "multi_thread")]
async fn a_codex_session_is_restored_after_its_agent_is_dropped() {
    let (Ok(adapter), Ok(codex)) = (
        std::env::var("OPENAB_E2E_CODEX_ACP"),
        std::env::var("OPENAB_E2E_CODEX"),
    ) else {
        eprintln!("skipped: OPENAB_E2E_CODEX_ACP and OPENAB_E2E_CODEX are not set");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    // This integration-test binary owns its HOME; isolate pool persistence.
    std::env::set_var("HOME", tmp.path());
    let codex_home = tmp.path().join("codex-home");
    let work = tmp.path().join("work");
    std::fs::create_dir_all(&codex_home).unwrap();
    std::fs::create_dir_all(&work).unwrap();
    let port = spawn_unauthorized_server();
    std::fs::write(
        codex_home.join("config.toml"),
        format!("openai_base_url = \"http://127.0.0.1:{port}/v1\"\n"),
    )
    .unwrap();
    let mut login = std::process::Command::new(&codex)
        .args(["login", "--with-api-key"])
        .env("CODEX_HOME", &codex_home)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .expect("run codex login");
    login
        .stdin
        .take()
        .unwrap()
        .write_all(b"sk-e2e-not-a-key\n")
        .unwrap();
    assert!(login.wait().unwrap().success(), "codex login failed");

    let agent = AgentConfig {
        command: "node".into(),
        args: vec![adapter],
        working_dir: work.to_string_lossy().into_owned(),
        env: HashMap::from([
            ("CODEX_PATH".to_string(), codex),
            (
                "CODEX_HOME".to_string(),
                codex_home.to_string_lossy().into_owned(),
            ),
        ]),
        inherit_env: vec![],
        command_explicit: true,
    };
    let pool = SessionPool::new(agent, 2, 60, HashMap::new());
    let key = "acp:codex-restore-e2e";

    pool.get_or_create(key, None, &[], None)
        .await
        .expect("start a Codex session");
    let session_id = pool
        .with_connection(key, |conn| {
            Box::pin(async move {
                let (mut rx, request_id) = conn
                    .session_prompt(vec![ContentBlock::Text {
                        text: "hello".into(),
                    }])
                    .await?;
                // The turn ends with the id-bearing response (here an error: the key is rejected).
                tokio::time::timeout(Duration::from_secs(90), async {
                    while let Some(msg) = rx.recv().await {
                        if msg.id == Some(request_id) {
                            return;
                        }
                    }
                })
                .await
                .map_err(|_| anyhow::anyhow!("the turn did not end"))?;
                conn.prompt_done(None).await;
                Ok(conn.acp_session_id.clone().unwrap())
            })
        })
        .await
        .unwrap();

    // Drop the agent and keep its session id, the way the pool suspends a session.
    pool.suspend_session(key).await;

    pool.get_or_create(key, None, &[], None)
        .await
        .expect("the next message restores the session");
    let (restored, reset) = pool
        .with_connection(key, |conn| {
            Box::pin(async move { Ok((conn.acp_session_id.clone(), conn.session_reset)) })
        })
        .await
        .unwrap();
    assert_eq!(
        restored.as_deref(),
        Some(session_id.as_str()),
        "the saved Codex session must be restored, not replaced"
    );
    assert!(!reset, "a restored session must not show the reset notice");
}
