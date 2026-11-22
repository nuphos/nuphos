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
    /// What the permission relay answers, as the gateway does once Stop lands.
    permission_outcome: Option<serde_json::Value>,
}

impl RecordingAdapter {
    fn new(streaming: bool) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            streaming,
            permission_outcome: None,
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
        let mut kind = update
            .get("sessionUpdate")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if kind == "agent_message_chunk" {
            kind = format!(
                "{kind}:{}",
                update["content"]["text"].as_str().unwrap_or("")
            );
        }
        self.calls.lock().unwrap().push(Call::Update(kind));
        Ok(())
    }
    async fn fail_agent_turn(
        &self,
        _: &ChannelRef,
        partial: &str,
        error: &str,
        _data: Option<serde_json::Value>,
    ) -> Result<()> {
        self.calls.lock().unwrap().push(Call::Failure {
            partial: partial.into(),
            error: error.into(),
        });
        Ok(())
    }
    fn use_streaming(&self, _other_bot_present: bool) -> bool {
        self.streaming
    }
    async fn request_agent_permission(
        &self,
        _: &ChannelRef,
        _relay_required: bool,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        Ok(self.permission_outcome.clone().unwrap_or_else(|| {
            openab_core::acp::connection::build_permission_response(Some(&params))
        }))
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

/// Asks permission mid-turn, then reports the outcome it was answered with.
const PERMISSION_AGENT: &str = r##"#!/bin/sh
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
      printf '{"jsonrpc":"2.0","id":900,"method":"session/request_permission","params":{"sessionId":"sess_fake","toolCall":{"toolCallId":"t1","title":"mkdir out"},"options":[{"optionId":"allow","name":"Allow","kind":"allow_once"}]}}\n'
      IFS= read -r answer
      case "$answer" in
        *'"id":900'*'"outcome":"cancelled"'*) got=cancelled ;;
        *) got=other ;;
      esac
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"%s"}}}}\n' "$got"
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

// ACP + streaming: text chunks are relayed as agent updates, on the same path as
// tool/thought updates and in exact arrival order, so a client that reattached
// after the turn's own connection dropped still receives them. The terminal send
// repeats the full text (the gateway has counted the chunks → no duplicate tail).
#[tokio::test(flavor = "multi_thread")]
async fn acp_streaming_relays_text_inline_in_arrival_order() {
    let _guard = env_lock();
    let fx = setup("acp", "acp:order").await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    run_turn(&fx, &adapter, "acp:order").await;

    let calls = recorder.calls();
    let expected = vec![
        Call::Update("agent_message_chunk:Linode C".into()),
        Call::Update("tool_call".into()),
        Call::Update("agent_thought_chunk".into()),
        Call::Update("agent_message_chunk:LI ok".into()),
        Call::Update("tool_call_update".into()),
        Call::Update("agent_message_chunk: done".into()),
        Call::Terminal {
            content: "Linode CLI ok done".into(),
            stop_reason: Some("end_turn".into()),
        },
    ];
    assert_eq!(
        calls, expected,
        "ACP streaming must relay text in arrival order and finish with a \
         terminal send carrying the full text"
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

// The first process takes a prompt and never writes again, without exiting and
// without answering `session/cancel`. A process that restored the session answers.
const SILENT_AGENT: &str = r##"#!/bin/sh
echo spawn >> calls
restored=
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{"loadSession":true}}}\n' "$id" ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake"}}\n' "$id" ;;
    *'"session/load"'*)
      echo "load $line" >> calls
      restored=1
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id" ;;
    *'"session/prompt"'*)
      [ -n "$restored" ] && printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id" ;;
  esac
done
"##;

// A process that stayed silent for the whole inactivity timeout is not kept: the
// next prompt is answered by a new process that restored the same session.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn acp_prompt_after_an_inactivity_timeout_gets_a_new_agent_process() {
    let _guard = env_lock();
    let key = "acp:silent";
    let fx = setup_with_timeout("acp", key, SILENT_AGENT, 1).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();

    run_turn(&fx, &adapter, key).await;
    assert!(
        matches!(recorder.calls().last(), Some(Call::Failure { error, .. })
        if error.contains("inactivity timeout")),
        "{:?}",
        recorder.calls()
    );

    fx.router
        .pool()
        .get_or_create(key, None, &[], None)
        .await
        .expect("the session is restored for the next prompt");
    run_turn(&fx, &adapter, key).await;

    let calls = std::fs::read_to_string(fx._tmp.path().join("calls")).unwrap();
    assert_eq!(calls.matches("spawn").count(), 2, "{calls}");
    assert!(
        calls
            .lines()
            .any(|l| l.starts_with("load ") && l.contains("\"sess_fake\"")),
        "the new process must session/load the same session: {calls}"
    );
    assert!(
        matches!(recorder.calls().last(), Some(Call::Terminal { stop_reason: Some(reason), .. })
        if reason == "end_turn"),
        "{:?}",
        recorder.calls()
    );
}

// A silent-on-prompt agent (so a turn dies on the inactivity timeout and the next prompt has to
// resume through session/load) whose restore always fails, and whose session ids differ per
// process so a fallback to session/new is visible in the persisted map.
const FAILING_LOAD_AGENT: &str = r##"#!/bin/sh
echo spawn >> calls
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{"loadSession":true}}}\n' "$id" ;;
    *'"session/new"'*)
      n=$(cat new_count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > new_count
      echo "new $n" >> calls
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_new%s"}}\n' "$id" "$n" ;;
    *'"session/load"'*)
      echo "load" >> calls
      printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"Internal error","data":{"details":"thread 3f2a already has an active writer"}}}\n' "$id" ;;
  esac
done
"##;

fn recorded_calls(fx: &Fixture) -> String {
    std::fs::read_to_string(fx._tmp.path().join("calls")).unwrap()
}

/// How many `session/new` calls the fake agents have answered so far.
fn session_new_calls(fx: &Fixture) -> usize {
    recorded_calls(fx)
        .lines()
        .filter(|line| line.starts_with("new "))
        .count()
}

/// The session id `thread_map.json` currently persists for `key`. The file is a plain
/// thread → session id object, the shape every runtime reads.
fn persisted_session(fx: &Fixture, key: &str) -> String {
    let data = std::fs::read_to_string(fx._tmp.path().join(".openab/thread_map.json")).unwrap();
    let map: HashMap<String, String> = serde_json::from_str(&data)
        .unwrap_or_else(|e| panic!("thread_map.json must stay a plain map: {e}\n{data}"));
    map.get(key)
        .cloned()
        .unwrap_or_else(|| panic!("no persisted session for {key} in {data}"))
}

/// Run a turn the agent never answers: it fails on the inactivity timeout and the agent is
/// killed, so the next `get_or_create` has to resume the session through `session/load`.
async fn kill_agent_with_a_timed_out_turn(fx: &Fixture, key: &str) {
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    run_turn(fx, &adapter, key).await;
    assert!(
        matches!(recorder.calls().last(), Some(Call::Failure { error, .. })
            if error.contains("inactivity timeout")),
        "{:?}",
        recorder.calls()
    );
}

// A restore that fails for any reason must not fail the turn, nor every turn after it (#3371):
// the thread continues in a new session and the user is told the saved context was dropped.
// The error is the one Codex gives while the dropped agent's own app server still holds the
// thread, which says nothing about whether the session is gone.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn acp_a_failed_load_continues_in_a_new_session() {
    let _guard = env_lock();
    let key = "acp:load-failed";
    let fx = setup_with_timeout("acp", key, FAILING_LOAD_AGENT, 1).await;
    assert_eq!(persisted_session(&fx, key), "sess_new1");
    kill_agent_with_a_timed_out_turn(&fx, key).await;

    fx.router
        .pool()
        .get_or_create(key, None, &[], None)
        .await
        .expect("a failed restore must not fail the turn");
    assert_eq!(persisted_session(&fx, key), "sess_new2");
    assert_eq!(session_new_calls(&fx), 2);
    let reset = fx
        .router
        .pool()
        .with_connection(key, |conn| Box::pin(async move { Ok(conn.session_reset) }))
        .await
        .unwrap();
    assert!(reset, "the user must see the session-reset banner");
}

// Stop answers a relayed permission request `cancelled` (gateway); the agent itself must
// receive that answer to its `session/request_permission`, so its turn can end.
#[tokio::test(flavor = "multi_thread")]
async fn acp_agent_receives_cancelled_for_a_released_permission_request() {
    let _guard = env_lock();
    let fx =
        setup_with_agent_and_streaming("acp", "acp:permission-stop", PERMISSION_AGENT, false).await;
    let recorder = Arc::new(RecordingAdapter {
        permission_outcome: Some(serde_json::json!({"outcome": {"outcome": "cancelled"}})),
        ..RecordingAdapter::new(false)
    });
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        run_turn(&fx, &adapter, "acp:permission-stop"),
    )
    .await
    .expect("the turn ends once the agent is answered");
    assert_eq!(
        recorder.calls(),
        vec![Call::Terminal {
            content: "cancelled".into(),
            stop_reason: Some("cancelled".into()),
        }],
    );
}

/// Asks the client a question mid-turn, as Antigravity's ask_question tool does, and
/// waits for the answer; refused, it asks in chat instead.
const ELICITATION_AGENT: &str = r##"#!/bin/sh
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
      printf '{"jsonrpc":"2.0","id":900,"method":"elicitation/create","params":{"sessionId":"sess_fake","mode":"form","message":"Which region?"}}\n'
      IFS= read -r answer
      case "$answer" in
        *'"code":-32601'*) got="Which region?" ;;
        *) got=other ;;
      esac
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"%s"}}}}\n' "$got"
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
  esac
done
"##;

// A request from the agent that nothing here answers is refused at once, so the agent
// goes on instead of waiting out the inactivity timeout.
#[tokio::test(flavor = "multi_thread")]
async fn acp_agent_request_without_an_answerer_is_refused() {
    let _guard = env_lock();
    let fx = setup_with_timeout("acp", "acp:elicitation", ELICITATION_AGENT, 30).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        run_turn(&fx, &adapter, "acp:elicitation"),
    )
    .await
    .expect("the turn ends once the agent is answered");
    assert!(
        matches!(recorder.calls().last(), Some(Call::Terminal { content, .. })
        if content == "Which region?"),
        "{:?}",
        recorder.calls()
    );
}

/// Runs one tool per turn and says whether `initialize` advertised the spec's
/// `terminal` capability.
const CAPABILITY_AGENT: &str = r##"#!/bin/sh
terminal=absent
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      case "$line" in *'"terminal":'*) terminal=advertised ;; esac
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake"}}\n' "$id"
      ;;
    *'"session/prompt"'*)
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"run hostname","kind":"execute","status":"in_progress"}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed"}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"terminal %s"}}}}\n' "$terminal"
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
  esac
done
"##;

// The client runs no terminals for the agent, so it must not offer them; the agent runs
// its tools itself and the turn completes as usual.
#[tokio::test(flavor = "multi_thread")]
async fn acp_turn_runs_tools_without_advertising_terminals() {
    let _guard = env_lock();
    let fx = setup_with_timeout("acp", "acp:capability", CAPABILITY_AGENT, 30).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        run_turn(&fx, &adapter, "acp:capability"),
    )
    .await
    .expect("the turn completes");
    let calls = recorder.calls();
    assert!(
        calls.contains(&Call::Update("tool_call".into())),
        "{calls:?}"
    );
    assert!(
        calls.contains(&Call::Update("tool_call_update".into())),
        "{calls:?}"
    );
    assert!(
        matches!(calls.last(), Some(Call::Terminal { content, .. })
        if content == "terminal absent"),
        "{calls:?}"
    );
}

/// Loses its session once: the first process answers the prompt with ACP "resource not
/// found", as claude-agent-acp does for a session it no longer holds. Every later process
/// restores the session with `session/load` and answers whether it was loaded.
const SESSION_GONE_ONCE_AGENT: &str = r##"#!/bin/sh
marker="$(dirname "$0")/session_gone_once"
loaded=fresh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"agentInfo":{"name":"fake","version":"0"},"agentCapabilities":{"loadSession":true}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"sess_fake"}}\n' "$id"
      ;;
    *'"session/load"'*)
      loaded=loaded
      printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id"
      ;;
    *'"session/prompt"'*)
      if [ ! -e "$marker" ]; then
        : > "$marker"
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32002,"message":"Resource not found: sess_fake","data":{"uri":"sess_fake"}}}\n' "$id"
      else
        printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"%s"}}}}\n' "$loaded"
        printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      fi
      ;;
  esac
done
"##;

// An agent that no longer holds the session answers the prompt with -32002 before any
// output. The turn restores the saved session (session/load) and runs once more instead
// of failing.
#[tokio::test(flavor = "multi_thread")]
async fn acp_prompt_for_a_lost_session_restores_it_and_runs_once_more() {
    let _guard = env_lock();
    let fx = setup_with_agent_and_streaming(
        "acp",
        "acp:session-gone-once",
        SESSION_GONE_ONCE_AGENT,
        false,
    )
    .await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();

    run_turn(&fx, &adapter, "acp:session-gone-once").await;

    let calls = recorder.calls();
    assert!(
        !calls
            .iter()
            .any(|call| matches!(call, Call::Failure { .. })),
        "the lost session failed the turn: {calls:?}"
    );
    assert!(
        calls
            .iter()
            .any(|call| matches!(call, Call::Terminal { content, .. } if content == "loaded")),
        "the turn did not run on the restored session: {calls:?}"
    );
}

const GONE: &str = r#"printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32002,"message":"Resource not found: sess_fake","data":{"uri":"sess_fake"}}}\n' "$id""#;
const INTERNAL_ERROR: &str = r#"printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"Internal error"}}\n' "$id""#;
const PARTIAL_THEN_GONE: &str = r#"printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"partial"}}}}\n'
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32002,"message":"Resource not found: sess_fake","data":{"uri":"sess_fake"}}}\n' "$id""#;
const PARTIAL_THEN_CANCELLED: &str = r#"printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_fake","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"partial"}}}}\n'
        printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"cancelled"}}\n' "$id""#;

/// A fake agent that can restore its session and gives every prompt, in any of its
/// processes, the same `answer`. Each prompt adds a line to `prompts` beside the script.
fn counting_agent(answer: &str) -> String {
    format!(
        r##"#!/bin/sh
prompts="$(dirname "$0")/prompts"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*)
      printf '{{"jsonrpc":"2.0","id":%s,"result":{{"agentInfo":{{"name":"fake","version":"0"}},"agentCapabilities":{{"loadSession":true}}}}}}\n' "$id"
      ;;
    *'"session/new"'*)
      printf '{{"jsonrpc":"2.0","id":%s,"result":{{"sessionId":"sess_fake"}}}}\n' "$id"
      ;;
    *'"session/load"'*)
      printf '{{"jsonrpc":"2.0","id":%s,"result":{{}}}}\n' "$id"
      ;;
    *'"session/prompt"'*)
      echo prompt >> "$prompts"
      {answer}
      ;;
  esac
done
"##
    )
}

/// Runs one send-once ACP turn against an agent giving every prompt `answer`, and returns
/// what the chat received and how many prompts the agent was sent.
async fn turn_with_answer(thread_key: &str, answer: &str) -> (Vec<Call>, usize) {
    let fx =
        setup_with_agent_and_streaming("acp", thread_key, &counting_agent(answer), false).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();

    run_turn(&fx, &adapter, thread_key).await;

    let prompts = std::fs::read_to_string(fx._tmp.path().join("prompts")).unwrap_or_default();
    (recorder.calls(), prompts.lines().count())
}

// Only "the agent lost the session" earns a second run; any other agent error fails the
// turn as it did before.
#[tokio::test(flavor = "multi_thread")]
async fn acp_prompt_error_other_than_a_lost_session_is_not_retried() {
    let _guard = env_lock();
    let (calls, prompts) = turn_with_answer("acp:internal-error", INTERNAL_ERROR).await;

    assert_eq!(prompts, 1, "{calls:?}");
    assert!(
        calls
            .iter()
            .any(|call| matches!(call, Call::Failure { .. })),
        "{calls:?}"
    );
}

// The rerun gets one chance: losing the session again fails the turn instead of looping.
#[tokio::test(flavor = "multi_thread")]
async fn acp_prompt_for_a_session_lost_twice_fails_after_one_retry() {
    let _guard = env_lock();
    let (calls, prompts) = turn_with_answer("acp:session-gone-twice", GONE).await;

    assert_eq!(prompts, 2, "{calls:?}");
    assert!(
        calls
            .iter()
            .any(|call| matches!(call, Call::Failure { .. })),
        "{calls:?}"
    );
}

// Once the turn has shown output, running it again would show it twice, so a lost session
// then fails the turn as before.
#[tokio::test(flavor = "multi_thread")]
async fn acp_session_lost_after_output_is_not_retried() {
    let _guard = env_lock();
    let (calls, prompts) =
        turn_with_answer("acp:session-gone-after-output", PARTIAL_THEN_GONE).await;

    assert_eq!(prompts, 1, "{calls:?}");
    assert!(
        calls
            .iter()
            .any(|call| matches!(call, Call::Failure { .. })),
        "{calls:?}"
    );
}

// A cancelled turn ends normally with its stop reason and is never run again.
#[tokio::test(flavor = "multi_thread")]
async fn acp_cancelled_turn_is_not_retried() {
    let _guard = env_lock();
    let (calls, prompts) = turn_with_answer("acp:cancelled-once", PARTIAL_THEN_CANCELLED).await;

    assert_eq!(prompts, 1, "{calls:?}");
    assert_eq!(
        calls,
        vec![Call::Terminal {
            content: "partial".into(),
            stop_reason: Some("cancelled".into()),
        }],
    );
}

// claude-agent-acp answers a prompt for a session it does not hold with a plain "Session not
// found", which the ACP SDK relays as -32603 with the text in `data.details`.
#[tokio::test(flavor = "multi_thread")]
async fn acp_prompt_answered_session_not_found_restores_it_and_runs_once_more() {
    let _guard = env_lock();
    let agent = SESSION_GONE_ONCE_AGENT.replace(
        r#"{"code":-32002,"message":"Resource not found: sess_fake","data":{"uri":"sess_fake"}}"#,
        r#"{"code":-32603,"message":"Internal error","data":{"details":"Session not found"}}"#,
    );
    assert_ne!(agent, SESSION_GONE_ONCE_AGENT);
    let fx =
        setup_with_agent_and_streaming("acp", "acp:session-not-found-once", &agent, false).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();

    run_turn(&fx, &adapter, "acp:session-not-found-once").await;

    let calls = recorder.calls();
    assert!(
        !calls
            .iter()
            .any(|call| matches!(call, Call::Failure { .. })),
        "the lost session failed the turn: {calls:?}"
    );
    assert!(
        calls
            .iter()
            .any(|call| matches!(call, Call::Terminal { content, .. } if content == "loaded")),
        "the turn did not run on the restored session: {calls:?}"
    );
}

// codex-acp answers a prompt for a session it does not hold with invalid params that name the
// session. That is the same loss, so the turn restores the session and runs once more too.
#[tokio::test(flavor = "multi_thread")]
async fn acp_prompt_answered_unknown_session_restores_it_and_runs_once_more() {
    let _guard = env_lock();
    let agent = SESSION_GONE_ONCE_AGENT.replace(
        r#"{"code":-32002,"message":"Resource not found: sess_fake","data":{"uri":"sess_fake"}}"#,
        r#"{"code":-32602,"message":"Invalid params: Unknown session: sess_fake"}"#,
    );
    assert_ne!(agent, SESSION_GONE_ONCE_AGENT);
    let fx = setup_with_agent_and_streaming("acp", "acp:unknown-session-once", &agent, false).await;
    let recorder = Arc::new(RecordingAdapter::new(false));
    let adapter: Arc<dyn ChatAdapter> = recorder.clone();

    run_turn(&fx, &adapter, "acp:unknown-session-once").await;

    let calls = recorder.calls();
    assert!(
        !calls
            .iter()
            .any(|call| matches!(call, Call::Failure { .. })),
        "the lost session failed the turn: {calls:?}"
    );
    assert!(
        calls
            .iter()
            .any(|call| matches!(call, Call::Terminal { content, .. } if content == "loaded")),
        "the turn did not run on the restored session: {calls:?}"
    );
}
