//! End-to-end ordering tests for the ACP direct-relay streaming path: a scripted
//! fake agent emits interleaved text / tool / thought session updates over real
//! stdio, and a recording ChatAdapter captures the relay order on the other side.

use anyhow::Result;
use async_trait::async_trait;
use openab_core::acp::{ContentBlock, SessionPool};
use openab_core::adapter::{AdapterRouter, ChannelRef, ChatAdapter, MessageRef};
use openab_core::config::{AgentConfig, ReactionsConfig};
use openab_core::markdown::TableMode;
use openab_core::reactions::StatusReactionController;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

/// Tests in this binary mutate process env (HOME, OPENAB_ACP_STREAMING); run them
/// one at a time. This file is its own test process, so no other test binary sees
/// the mutations.
fn env_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Clone, PartialEq)]
enum Call {
    Send(String),
    Terminal {
        content: String,
        stop_reason: Option<String>,
    },
    Edit {
        message_id: String,
        content: String,
    },
    Update(String),
    Failure {
        partial: String,
        error: String,
    },
}

struct RecordingAdapter {
    calls: Mutex<Vec<Call>>,
    streaming: bool,
}

impl RecordingAdapter {
    fn new(streaming: bool) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            streaming,
        }
    }
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
}

#[async_trait]
impl ChatAdapter for RecordingAdapter {
    fn platform(&self) -> &'static str {
        "unified"
    }
    fn message_limit(&self) -> usize {
        4096
    }
    async fn send_message(&self, channel: &ChannelRef, content: &str) -> Result<MessageRef> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Send(content.to_string()));
        Ok(MessageRef {
            channel: channel.clone(),
            message_id: "m1".into(),
        })
    }
    async fn send_terminal_message(
        &self,
        channel: &ChannelRef,
        content: &str,
        stop_reason: Option<&str>,
    ) -> Result<MessageRef> {
        self.calls.lock().unwrap().push(Call::Terminal {
            content: content.to_string(),
            stop_reason: stop_reason.map(str::to_string),
        });
        Ok(MessageRef {
            channel: channel.clone(),
            message_id: "m1".into(),
        })
    }
    async fn create_thread(&self, _: &ChannelRef, _: &MessageRef, _: &str) -> Result<ChannelRef> {
        unimplemented!()
    }
    async fn add_reaction(&self, _: &MessageRef, _: &str) -> Result<()> {
        Ok(())
    }
    async fn remove_reaction(&self, _: &MessageRef, _: &str) -> Result<()> {
        Ok(())
    }
    async fn edit_message(&self, msg: &MessageRef, content: &str) -> Result<()> {
        self.calls.lock().unwrap().push(Call::Edit {
            message_id: msg.message_id.clone(),
            content: content.to_string(),
        });
        Ok(())
    }
    async fn forward_agent_update(&self, _: &ChannelRef, update: serde_json::Value) -> Result<()> {
        let kind = update
            .get("sessionUpdate")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        self.calls.lock().unwrap().push(Call::Update(kind));
        Ok(())
    }
    async fn fail_agent_turn(&self, _: &ChannelRef, partial: &str, error: &str) -> Result<()> {
        self.calls.lock().unwrap().push(Call::Failure {
            partial: partial.into(),
            error: error.into(),
        });
        Ok(())
    }
    fn use_streaming(&self, _other_bot_present: bool) -> bool {
        self.streaming
    }
}

/// A line-delimited JSON-RPC fake agent: answers initialize / session/new, and on
/// session/prompt emits text chunks interleaved with tool + thought updates before
/// the final response — the exact shape that reproduced the production reordering.
const FAKE_AGENT: &str = r##"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake"}}\n' "$id"
      ;;
    *'"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Linode C"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"check availability","status":"pending"}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thinking"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"LI ok"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","title":"check availability","status":"completed"}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":" done"}}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
  esac
done
"##;

const LATE_TOOL_AGENT: &str = r##"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake"}}\n' "$id"
      ;;
    *'"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"before"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"tool_call","toolCallId":"late","title":"watch checks","status":"in_progress"}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"tool_call_update","toolCallId":"late","title":"watch checks","status":"completed"}}}\n'
      ;;
  esac
done
"##;

const CANCELLED_AGENT: &str = r##"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake"}}\n' "$id"
      ;;
    *'"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"partial"}}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"cancelled"}}\n' "$id"
      ;;
  esac
done
"##;

struct Fixture {
    router: AdapterRouter,
    channel: ChannelRef,
    _tmp: tempfile::TempDir,
}

async fn setup(platform: &str, thread_key: &str) -> Fixture {
    setup_with_agent(platform, thread_key, FAKE_AGENT).await
}

async fn setup_with_agent(platform: &str, thread_key: &str, fake_agent: &str) -> Fixture {
    setup_with_agent_and_streaming(platform, thread_key, fake_agent, true).await
}
async fn setup_with_agent_and_streaming(
    platform: &str,
    thread_key: &str,
    fake_agent: &str,
    streaming: bool,
) -> Fixture {
    setup_complete(platform, thread_key, fake_agent, streaming, 30).await
}
async fn setup_with_timeout(
    platform: &str,
    thread_key: &str,
    fake_agent: &str,
    timeout: u64,
) -> Fixture {
    setup_complete(platform, thread_key, fake_agent, true, timeout).await
}
async fn setup_complete(
    platform: &str,
    thread_key: &str,
    fake_agent: &str,
    streaming: bool,
    timeout: u64,
) -> Fixture {
    let tmp = tempfile::tempdir().expect("tempdir");
    // Isolate ~/.openab persistence (thread_map.json / session_meta.json).
    std::env::set_var("HOME", tmp.path());
    if streaming {
        std::env::set_var("OPENAB_ACP_STREAMING", "1");
    } else {
        std::env::remove_var("OPENAB_ACP_STREAMING");
    }
    std::env::remove_var("OPENAB_STREAM_EDIT_INTERVAL_MS");

    let script = tmp.path().join("fake_agent.sh");
    std::fs::write(&script, fake_agent).expect("write fake agent");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    let agent_cfg = AgentConfig {
        command: script.to_string_lossy().into_owned(),
        args: vec![],
        working_dir: tmp.path().to_string_lossy().into_owned(),
        env: HashMap::new(),
        inherit_env: vec![],
        command_explicit: true,
    };
    let pool = Arc::new(SessionPool::new(agent_cfg, 1, 60, HashMap::new()));
    pool.get_or_create(thread_key, None, &[], None)
        .await
        .expect("session spawn against fake agent");

    let router = AdapterRouter::new(
        pool,
        ReactionsConfig::default(),
        TableMode::Code,
        timeout,
        1,
        HashMap::new(),
        tmp.path().to_path_buf(),
    );
    let channel = ChannelRef {
        platform: platform.into(),
        channel_id: format!("{platform}_chan"),
        thread_id: None,
        parent_id: None,
        origin_event_id: Some("evt_test".into()),
    };
    Fixture {
        router,
        channel,
        _tmp: tmp,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn acp_turn_completes_without_waiting_for_background_tool() {
    let _guard = env_lock();
    // The tool never supplies a terminal update. Neither this turn nor the
    // next prompt on the same session may be held by its card's status.
    let agent = LATE_TOOL_AGENT
        .lines()
        .filter(|line| !line.contains("tool_call_update"))
        .collect::<Vec<_>>()
        .join("\n");
    let fx = setup_with_agent("acp", "acp:unfinished-tool", &agent).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    for _ in 0..2 {
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            run_turn(&fx, &adapter, "acp:unfinished-tool"),
        )
        .await
        .expect("provider completion must release admission for the next prompt");
    }
    assert_eq!(recorder.calls().iter().filter(|call|
        matches!(call, Call::Terminal { stop_reason: Some(reason), .. } if reason == "end_turn")
    ).count(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn acp_late_background_tool_update_survives_prompt_completion() {
    let _guard = env_lock();
    let fx = setup_with_agent("acp", "acp:late-tool", LATE_TOOL_AGENT).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        run_turn(&fx, &adapter, "acp:late-tool"),
    )
    .await
    .expect("provider completion must not wait for a background tool");
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !recorder
            .calls()
            .contains(&Call::Update("tool_call_update".into()))
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("late tool result must reach the background relay");
    let calls = recorder.calls();
    assert_eq!(
        calls
            .iter()
            .filter(|call| matches!(call, Call::Terminal { .. }))
            .count(),
        1
    );
    assert!(calls.contains(&Call::Update("tool_call".into())));
    assert!(calls.contains(&Call::Terminal {
        content: "before".into(),
        stop_reason: Some("end_turn".into()),
    }));
}

#[tokio::test(flavor = "multi_thread")]
async fn acp_send_once_preserves_the_runtime_stop_reason() {
    let _guard = env_lock();
    let fx =
        setup_with_agent_and_streaming("acp", "acp:send-once-cancelled", CANCELLED_AGENT, false)
            .await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();

    run_turn(&fx, &adapter, "acp:send-once-cancelled").await;

    assert_eq!(
        recorder.calls(),
        vec![Call::Terminal {
            content: "partial".into(),
            stop_reason: Some("cancelled".into()),
        }],
    );
}

async fn run_turn(fx: &Fixture, adapter: &Arc<dyn ChatAdapter>, thread_key: &str) {
    let reactions = Arc::new(StatusReactionController::new(
        false,
        adapter.clone(),
        MessageRef {
            channel: fx.channel.clone(),
            message_id: "trigger".into(),
        },
        Default::default(),
        Default::default(),
    ));
    fx.router
        .stream_prompt_blocks(
            adapter,
            thread_key,
            vec![ContentBlock::Text { text: "hi".into() }],
            &fx.channel,
            reactions,
            false,
            None,
        )
        .await
        .expect("turn completes");
}

// ACP + streaming: text snapshots are relayed inline, so they interleave with
// tool/thought updates in exact arrival order, and the terminal send repeats the
// last snapshot verbatim (the gateway diffs it to nothing → no duplicate tail).
#[tokio::test(flavor = "multi_thread")]
async fn acp_streaming_relays_text_inline_in_arrival_order() {
    let _guard = env_lock();
    let fx = setup("acp", "acp:order").await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    run_turn(&fx, &adapter, "acp:order").await;

    let calls = recorder.calls();
    let expected = vec![
        Call::Edit {
            message_id: "draft".into(),
            content: "Linode C".into(),
        },
        Call::Update("tool_call".into()),
        Call::Update("agent_thought_chunk".into()),
        Call::Edit {
            message_id: "draft".into(),
            content: "Linode CLI ok".into(),
        },
        Call::Update("tool_call_update".into()),
        Call::Edit {
            message_id: "draft".into(),
            content: "Linode CLI ok done".into(),
        },
        Call::Terminal {
            content: "Linode CLI ok done".into(),
            stop_reason: Some("end_turn".into()),
        },
    ];
    assert_eq!(
        calls, expected,
        "ACP streaming must relay text in arrival order and finish with a \
         terminal send identical to the last snapshot"
    );
}

// Non-ACP platforms keep the paced edit loop: with the default 1500ms interval a
// fast turn produces no mid-stream partial edits — text is never relayed inline
// and agent updates are not forwarded.
#[tokio::test(flavor = "multi_thread")]
async fn non_acp_streaming_keeps_paced_edit_loop() {
    let _guard = env_lock();
    let fx = setup("gateway", "gateway:paced").await;
    let recorder = Arc::new(RecordingAdapter::new(true));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    run_turn(&fx, &adapter, "gateway:paced").await;

    let calls = recorder.calls();
    assert!(
        !calls.iter().any(|c| matches!(c, Call::Update(_))),
        "agent updates must not be forwarded off the ACP path: {calls:?}"
    );
    assert_eq!(
        calls.first(),
        Some(&Call::Send("…".into())),
        "non-ACP streaming still opens with the placeholder: {calls:?}"
    );
    // The fake turn finishes far below the 1500ms pacing interval, so the only
    // edit is the finalize write — no inline per-chunk edits.
    let edits: Vec<&Call> = calls
        .iter()
        .filter(|c| matches!(c, Call::Edit { .. }))
        .collect();
    assert_eq!(edits.len(), 1, "expected only the finalize edit: {calls:?}");
    match edits[0] {
        Call::Edit { content, .. } => assert!(
            content.contains("Linode CLI ok done"),
            "finalize edit must carry the full text: {content}"
        ),
        _ => unreachable!(),
    }
}

/// A fake agent that stays silent for 3s after `session/prompt` — long enough
/// for the router's 1s liveness tick to fire several times — then completes.
const SLOW_AGENT: &str = r##"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake"}}\n' "$id"
      ;;
    *'"session/prompt"'*)
      sleep 3
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"done"}}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
  esac
done
"##;

// ACP: while the agent is alive but silent (a long tool call), each liveness
// tick must emit a schema-valid `session_info_update` heartbeat so the
// gateway's per-chunk idle timer keeps resetting instead of killing the turn.
#[tokio::test(flavor = "multi_thread")]
async fn acp_liveness_tick_emits_session_info_heartbeat() {
    let _guard = env_lock();
    let fx = setup_with_agent("acp", "acp:heartbeat", SLOW_AGENT).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    run_turn(&fx, &adapter, "acp:heartbeat").await;

    let calls = recorder.calls();
    let heartbeats = calls
        .iter()
        .filter(|c| matches!(c, Call::Update(k) if k == "session_info_update"))
        .count();
    assert!(
        heartbeats >= 1,
        "expected at least one session_info_update heartbeat during the \
         3s-silent prompt (1s liveness interval): {calls:?}"
    );
}

// Non-ACP platforms must not receive heartbeats — the idle-timer problem the
// heartbeat solves only exists on the ACP gateway path.
#[tokio::test(flavor = "multi_thread")]
async fn non_acp_liveness_tick_emits_no_heartbeat() {
    let _guard = env_lock();
    let fx = setup_with_agent("gateway", "gateway:heartbeat", SLOW_AGENT).await;
    let recorder = Arc::new(RecordingAdapter::new(true));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    run_turn(&fx, &adapter, "gateway:heartbeat").await;

    let calls = recorder.calls();
    assert!(
        !calls.iter().any(|c| matches!(c, Call::Update(_))),
        "no agent updates (heartbeats included) may leave the ACP path: {calls:?}"
    );
}

// These failures must reach ACP as terminal errors even after partial text.
// The cancel path deliberately emits a late tool update: it must never wake
// an autonomous turn after the failed prompt has been closed.
const FAILING_AGENT: &str = r##"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id" ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake"}}\n' "$id" ;;
    *'"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Working"}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"tool_call","toolCallId":"pending","status":"pending","title":"test"}}}\n'
      # FAILURE
      ;;
    *'"session/cancel"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"tool_call_update","toolCallId":"pending","status":"failed"}}}\n' ;;
  esac
done
"##;

async fn assert_failed_turn(script: &str, expected: &str, timeout: u64) {
    for streaming in [None, Some("0"), Some("1")] {
        assert_failed_turn_in_mode(script, expected, timeout, streaming).await;
    }
}

async fn assert_failed_turn_in_mode(
    script: &str,
    expected: &str,
    timeout: u64,
    streaming: Option<&str>,
) {
    let fx = setup_with_timeout("acp", "acp:failure", script, timeout).await;
    match streaming {
        Some(value) => std::env::set_var("OPENAB_ACP_STREAMING", value),
        None => std::env::remove_var("OPENAB_ACP_STREAMING"),
    }
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    run_turn(&fx, &adapter, "acp:failure").await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let calls = recorder.calls();
    assert!(
        matches!(calls.last(), Some(Call::Failure { partial, error })
        if partial == "Working" && error.contains(expected)),
        "{calls:?}"
    );
    assert!(
        !calls.iter().any(|c| matches!(c, Call::Send(_))),
        "must not send success: {calls:?}"
    );
    assert!(
        !calls
            .iter()
            .any(|c| matches!(c, Call::Update(k) if k == "tool_call_update")),
        "cancelled tool must not become an autonomous turn: {calls:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn acp_disk_full_is_a_terminal_error_with_partial_output() {
    let _guard = env_lock();
    let script = FAILING_AGENT.replace("# FAILURE", r#"printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"ENOSPC: no space left on device"}}\n' "$id""#);
    assert_failed_turn(&script, "ENOSPC", 30).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn acp_process_exit_is_a_terminal_error_with_partial_output() {
    let _guard = env_lock();
    assert_failed_turn(
        &FAILING_AGENT.replace("# FAILURE", "exit 1"),
        "exited unexpectedly",
        30,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn acp_inactivity_timeout_drops_late_cancel_updates() {
    let _guard = env_lock();
    assert_failed_turn(FAILING_AGENT, "inactivity timeout", 1).await;
}
