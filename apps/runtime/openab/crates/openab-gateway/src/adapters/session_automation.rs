//! Runtime-owned continuations. Backend connections only carry output/permission RPCs.
use super::*;
use std::collections::BTreeSet;

/// Bound on the whole internal continuation call (`handle_session_prompt` + response
/// forwarding), strictly below the pool's hung-session watchdog
/// (`prompt_hard_timeout_secs` 1800s + `hung_grace_secs` 120s) so this loop owns
/// reporting the failure instead of silently hanging until that backstop fires.
const CONTINUATION_TIMEOUT_SECS: u64 = 600;

/// How often to log that a continuation is still pending, so a stall is visible
/// well before `CONTINUATION_TIMEOUT_SECS` elapses. Shortened under test so the
/// mid-wait log can be asserted without a slow test.
#[cfg(not(test))]
const CONTINUATION_PROGRESS_LOG_SECS: u64 = 60;
#[cfg(test)]
const CONTINUATION_PROGRESS_LOG_SECS: u64 = 1;

#[derive(Default)]
pub struct SessionAutomation(std::sync::Mutex<HashMap<String, Automation>>);
#[derive(Default)]
struct Automation {
    context: Option<(Vec<Value>, Option<Value>)>,
    pending: BTreeSet<String>,
    observed: BTreeSet<String>,
    origins: BTreeSet<String>,
    tasks: HashMap<String, (String, Option<String>)>,
    generation: u64,
    worker: bool,
    running: bool,
    cancelled: bool,
    blocked_on: Option<String>,
    provider_epoch: Option<String>,
    error: Option<String>,
}
impl SessionAutomation {
    pub fn enabled(&self, channel: &str) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(channel)
            .is_some_and(|entry| entry.context.is_some())
    }

    #[cfg(test)]
    pub(super) fn configure(&self, channel: &str, servers: Vec<Value>, meta: Option<Value>) {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let entry = all.entry(channel.into()).or_default();
        entry.context = Some((servers, meta));
        entry.origins.insert("fixture-turn".into());
    }
    /// Serialize automatic dispatch with cancellation, through the broadcast write.
    pub(super) fn dispatch<T>(
        &self,
        channel: &str,
        generation: Option<u64>,
        context: Option<(Vec<Value>, Option<Value>)>,
        origin: &str,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(generation) = generation {
            if !all
                .get(channel)
                .is_some_and(|entry| entry.generation == generation && entry.worker)
            {
                return Err("Runtime continuation cancelled".into());
            }
        }
        let result = action()?;
        if let Some(context) = context {
            let entry = all.entry(channel.into()).or_default();
            entry.context = Some(context);
            entry.origins.insert(origin.into());
            if generation.is_none() {
                entry.cancelled = false;
            }
        }
        Ok(result)
    }
    pub fn cancel(&self, channel: &str) {
        self.cancel_with(channel, || ());
    }
    pub(super) fn cancel_with<T>(&self, channel: &str, action: impl FnOnce() -> T) -> T {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = all.get_mut(channel) {
            entry.cancelled = true;
            entry.pending.clear();
            entry
                .observed
                .extend(entry.tasks.iter().map(|(id, (origin, token))| {
                    format!("{id}:{}", token.as_deref().unwrap_or(origin))
                }));
            entry.tasks.clear();
            entry.blocked_on = None;
            entry.generation += 1;
            entry.worker = false;
            entry.running = false;
        }
        action()
    }
    pub fn observe_provider_epoch(&self, channel: &str, epoch: Option<&str>) {
        let Some(epoch) = epoch else {
            return;
        };
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let Some(entry) = all.get_mut(channel) else {
            return;
        };
        if entry
            .provider_epoch
            .as_deref()
            .is_some_and(|previous| previous != epoch)
        {
            if !entry.pending.is_empty() {
                entry.error = Some("Provider replaced before automatic continuation".into());
            }
            entry.pending.clear();
            entry.tasks.clear();
            entry.observed.clear();
            entry.worker = false;
            entry.running = false;
            entry.generation += 1;
        }
        entry.provider_epoch = Some(epoch.into());
    }
    fn blocked_on(&self, channel: &str, generation: u64, reason: Option<&str>) {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = all.get_mut(channel).filter(|e| e.generation == generation) {
            entry.blocked_on = reason.map(str::to_owned);
        }
    }
    pub fn snapshot(&self, channel: &str) -> Value {
        let all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        match all.get(channel) {
            Some(entry) => {
                json!({"pending":entry.pending,"running":entry.running,"error":entry.error,"blockedOn":entry.blocked_on})
            }
            None => json!({"pending":[],"running":false,"error":null}),
        }
    }
    fn observe(&self, channel: &str, update: &Value, accepted: &AcceptedReply) -> Option<u64> {
        if accepted.channel != channel {
            return None;
        }
        let tool = matches!(
            update["sessionUpdate"].as_str(),
            Some("tool_call" | "tool_call_update")
        );
        let id = if tool {
            format!("tool:{}", update["toolCallId"].as_str()?)
        } else {
            update["asyncTaskId"].as_str()?.to_owned()
        };
        let status = if tool {
            &update["status"]
        } else {
            &update["state"]
        };
        let terminal = matches!(
            status.as_str(),
            Some("completed" | "failed" | "cancelled" | "stopped")
        );
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let entry = all.get_mut(channel)?;
        if entry.cancelled || !entry.origins.contains(&accepted.origin) {
            return None;
        }
        let token = update
            .pointer("/_meta/dev.openab~1taskToken")
            .and_then(Value::as_str);
        if token.is_some()
            && update
                .pointer("/_meta/dev.openab~1taskEpoch")
                .and_then(Value::as_str)
                != entry.provider_epoch.as_deref()
        {
            return None;
        }
        if tool && token.is_none() {
            return None;
        }
        if update["sessionUpdate"] == "async_task_spawned" || (tool && !terminal) {
            entry.tasks.insert(
                id.clone(),
                (accepted.origin.clone(), token.map(str::to_owned)),
            );
            return None;
        }
        let owned = entry.tasks.get(&id).is_some_and(|(origin, spawned_token)| {
            if let Some(spawned_token) = spawned_token {
                token == Some(spawned_token.as_str())
            } else {
                *origin == accepted.origin
            }
        });
        if (!tool && update["sessionUpdate"] != "async_task_state_update")
            || (tool
                && update.pointer("/_meta/dev.openab~1backgroundTool") != Some(&Value::Bool(true)))
            || !matches!(status.as_str(), Some("completed" | "failed"))
            || !owned
            || !entry
                .observed
                .insert(format!("{id}:{}", token.unwrap_or(&accepted.origin)))
        {
            return None;
        }
        entry
            .pending
            .insert(format!("{id}:{}", status.as_str().unwrap()));
        entry.error = None;
        if entry.worker {
            return None;
        }
        entry.worker = true;
        Some(entry.generation)
    }
}

pub fn observe_runtime_reply(
    state: &Arc<crate::AppState>,
    reply: &GatewayReply,
    accepted: AcceptedReply,
) {
    if reply.command.as_deref() != Some("agent_update") {
        return;
    }
    let Ok(update) = serde_json::from_str::<Value>(&reply.content.text) else {
        return;
    };
    let channel = reply.channel.id.clone();
    let Some(generation) = state
        .acp_session_automation
        .observe(&channel, &update, &accepted)
    else {
        return;
    };
    let state = state.clone();
    tokio::spawn(async move { run(state, channel, generation).await });
}

async fn run(state: Arc<crate::AppState>, channel: String, generation: u64) {
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let context = {
            let mut all = state
                .acp_session_automation
                .0
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let Some(entry) = all.get_mut(&channel).filter(|e| e.generation == generation) else {
                return;
            };
            if entry.pending.is_empty() {
                entry.worker = false;
                return;
            }
            entry.context.clone()
        };
        let Some((servers, meta)) = context else {
            return;
        };
        let Some(read) = state.acp_session_snapshot.as_ref() else {
            return;
        };
        let provider = read(channel.clone()).await;
        if matches!(provider["state"].as_str(), Some("interrupted" | "dormant")) {
            let mut all = state
                .acp_session_automation
                .0
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(entry) = all.get_mut(&channel).filter(|e| e.generation == generation) {
                entry.pending.clear();
                entry.worker = false;
                entry.running = false;
                entry.error = Some("The provider session ended before continuation".into());
            }
            return;
        }

        if provider["state"] != "idle"
            || provider["operation"].as_str().is_some_and(|v| v != "none")
        {
            continue;
        }
        if !state.acp_session_requests.pending(&channel).is_empty() {
            continue;
        }
        let route = state.acp_reply_registry.as_ref().and_then(|registry| {
            let all = registry.lock().unwrap_or_else(|e| e.into_inner());
            let sink = all
                .get(&channel)
                .filter(|s| s.turn_id.is_none() && !s.out_tx.is_closed())?;
            Some((
                sink.session_id.clone(),
                sink.out_tx.clone(),
                sink.owner.clone(),
                sink.generation,
                sink.permission_relay.clone(),
            ))
        });
        let Some((session_id, output, owner, connection_generation, permission_relay)) = route
        else {
            state
                .acp_session_automation
                .blocked_on(&channel, generation, Some("connection"));
            continue;
        };
        state
            .acp_session_automation
            .blocked_on(&channel, generation, None);
        let tasks = {
            let mut all = state
                .acp_session_automation
                .0
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let Some(entry) = all.get_mut(&channel).filter(|e| e.generation == generation) else {
                return;
            };
            entry.running = true;
            entry.pending.iter().cloned().collect::<Vec<_>>()
        };
        let prompt = format!("<runtime-background-task-completion>\nThe runtime observed these background terminal tasks reach a terminal state: {}.\nInspect the completed command results already in this session, continue the work waiting for them, and report the outcome. Do not start a duplicate command.\n</runtime-background-task-completion>", json!(tasks));
        let sessions = Arc::new(tokio::sync::Mutex::new(HashMap::from([(
            session_id.clone(),
            AcpSession {
                channel_id: channel.clone(),
                busy: true,
                cancel: None,
                mcp_servers: servers,
                session_meta: meta,
                permission_relay,
            },
        )])));
        let params = json!({"sessionId":session_id,"prompt":[{"type":"text","text":prompt}],"_runtimeResumeGeneration":generation});
        // Intercept only our internal response. Notifications go to the current client unchanged.
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let internal_id = json!(format!("runtime_resume_{}", Uuid::new_v4()));
        let response_id = internal_id.clone();
        let forward = async {
            while let Some(message) = rx.recv().await {
                if let Ok(frame) = serde_json::from_str::<Value>(&message) {
                    if frame["id"] == response_id
                        && (frame.get("result").is_some() || frame.get("error").is_some())
                    {
                        return frame;
                    }
                }
                let _ = output.send(message);
            }
            json!({"error":{"message":"Continuation transport closed"}})
        };
        let cancel = Arc::new(tokio::sync::Notify::new());
        // Scoped so the joined future (which owns `output` via `forward`) is
        // dropped once it settles, freeing `output` for reuse below.
        let outcome = {
            let joined = async {
                tokio::join!(
                    handle_session_prompt(
                        &state,
                        &sessions,
                        internal_id,
                        Some(&params),
                        &tx,
                        session_id,
                        cancel,
                        &owner,
                        connection_generation
                    ),
                    forward
                )
            };
            tokio::pin!(joined);
            let deadline =
                tokio::time::sleep(std::time::Duration::from_secs(CONTINUATION_TIMEOUT_SECS));
            tokio::pin!(deadline);
            let mut progress = tokio::time::interval(std::time::Duration::from_secs(
                CONTINUATION_PROGRESS_LOG_SECS,
            ));
            progress.tick().await; // the first tick fires immediately; skip it
            let mut progress_ticks: u64 = 0;
            loop {
                tokio::select! {
                    result = &mut joined => break Ok(result),
                    _ = &mut deadline => break Err(()),
                    _ = progress.tick() => {
                        progress_ticks += 1;
                        warn!(
                            channel = %redact_id(&channel),
                            elapsed_secs = progress_ticks * CONTINUATION_PROGRESS_LOG_SECS,
                            timeout_secs = CONTINUATION_TIMEOUT_SECS,
                            "background continuation still waiting for the runtime"
                        );
                    }
                }
            }
        };
        // The prompt installed its forwarding channel as the idle sink. Restore the
        // live connection output before dropping it; never overwrite a successor.
        if let Some(registry) = &state.acp_reply_registry {
            if let Some(sink) = registry
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get_mut(&channel)
            {
                if sink.owner == owner && sink.out_tx.same_channel(&tx) {
                    sink.out_tx = output;
                }
            }
        }
        let mut all = state
            .acp_session_automation
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(entry) = all.get_mut(&channel).filter(|e| e.generation == generation) else {
            return;
        };
        entry.running = false;
        let Ok((_, response)) = outcome else {
            // No progress within CONTINUATION_TIMEOUT_SECS; surface a real failure instead
            // of leaving the UI on "resuming" until the pool's own hung-session watchdog
            // eventually force-recovers it. Retry on the next tick.
            warn!(
                channel = %redact_id(&channel),
                timeout_secs = CONTINUATION_TIMEOUT_SECS,
                "background continuation timed out waiting for the runtime"
            );
            entry.error = Some("Continuation timed out waiting for the runtime".into());
            continue;
        };
        if matches!(
            response["error"]["message"].as_str(),
            Some("ACP session output sink is unavailable" | "Runtime session is busy")
        ) {
            continue;
        } // A user won admission; retain the continuation.
        for task in tasks {
            entry.pending.remove(&task);
        }
        entry.error = response["error"]["message"].as_str().map(str::to_owned);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn accepted(channel: &str) -> AcceptedReply {
        AcceptedReply {
            channel: channel.into(),
            origin: "fixture-turn".into(),
        }
    }
    fn spawn_task(automation: &SessionAutomation, channel: &str, id: &str) {
        automation.observe(
            channel,
            &json!({"sessionUpdate":"async_task_spawned","asyncTaskId":id}),
            &accepted(channel),
        );
    }
    #[tokio::test]
    async fn runtime_starts_one_continuation_without_a_backend_prompt() {
        let (events, mut incoming) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(events);
        state.acp_session_snapshot = Some(Arc::new(|_| {
            Box::pin(async { json!({"state":"idle","operation":"none"}) })
        }));
        let registry = new_reply_registry();
        state.acp_reply_registry = Some(registry.clone());
        let state = Arc::new(state);
        let channel = "acp_173201f5-7973-4186-ae78-e63c2988d1b9";
        let session = "sess_173201f5-7973-4186-ae78-e63c2988d1b9";
        let (output, mut messages) = mpsc::unbounded_channel();
        install_reply_sink(
            &registry,
            channel,
            ReplySink {
                turn_id: None,
                tx: None,
                session_id: session.into(),
                out_tx: output,
                owner: "client".into(),
                generation: 1,
                permission_relay: None,
            },
        );
        state.acp_session_automation.configure(
            channel,
            vec![],
            Some(json!({"ai.nuphos/runtimeAuthority":2})),
        );
        let update = json!({"sessionUpdate":"async_task_state_update","asyncTaskId":"t","state":"completed"});
        spawn_task(&state.acp_session_automation, channel, "t");
        let generation = state
            .acp_session_automation
            .observe(channel, &update, &accepted(channel))
            .unwrap();
        assert!(state
            .acp_session_automation
            .observe(channel, &update, &accepted(channel))
            .is_none());
        assert_eq!(
            read_runtime_snapshot(&state, channel).await.unwrap()["phase"],
            "resume_pending"
        );
        let task = tokio::spawn(run(state.clone(), channel.into(), generation));
        let payload = tokio::time::timeout(std::time::Duration::from_secs(2), incoming.recv())
            .await
            .unwrap()
            .unwrap();
        let event: Value = serde_json::from_str(&payload).unwrap();
        assert!(payload.contains("runtime-background-task-completion"));
        assert_eq!(
            read_runtime_snapshot(&state, channel).await.unwrap()["phase"],
            "resuming"
        );
        let response: GatewayReply = serde_json::from_value(json!({
            "schema":"openab.gateway.reply.v1", "platform":"acp", "channel":{"id":channel}, "reply_to":event["event_id"],
            "content":{"type":"text","text":"continued"}, "command":"finish_turn:end_turn"
        }))
        .unwrap();
        handle_reply(&response, &registry).await;
        tokio::time::timeout(std::time::Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
        assert!(
            !incoming.try_recv().is_ok(),
            "duplicate terminal update must not prompt twice"
        );
        assert_eq!(
            read_runtime_snapshot(&state, channel).await.unwrap()["actions"]["send"],
            true
        );
        let message: Value = serde_json::from_str(&messages.recv().await.unwrap()).unwrap();
        assert_eq!(message["method"], "session/update");
        assert_eq!(message["params"]["sessionId"], session);
        assert!(
            !registry.lock().unwrap()[channel].out_tx.is_closed(),
            "idle route survives internal response forwarding"
        );
    }

    /// `CONTINUATION_PROGRESS_LOG_SECS` is shortened under `cfg(test)` to 1s, so a
    /// couple of seconds of real wait is enough to observe the mid-wait log fire
    /// well before `CONTINUATION_TIMEOUT_SECS` (600s) without a slow test.
    #[tokio::test]
    async fn continuation_wait_logs_progress_before_the_hard_timeout() {
        use std::io::Write;
        use std::sync::{Arc as StdArc, Mutex as StdMutex};

        #[derive(Clone)]
        struct Cap(StdArc<StdMutex<Vec<u8>>>);
        impl Write for Cap {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let buf = StdArc::new(StdMutex::new(Vec::new()));
        let cap = Cap(buf.clone());
        let sub = tracing_subscriber::fmt()
            .with_writer(move || cap.clone())
            .with_ansi(false)
            .finish();
        let _guard = tracing::subscriber::set_default(sub);

        let (events, mut incoming) = tokio::sync::broadcast::channel(16);
        let mut state = crate::AppState::test_default(events);
        state.acp_session_snapshot = Some(Arc::new(|_| {
            Box::pin(async { json!({"state":"idle","operation":"none"}) })
        }));
        let registry = new_reply_registry();
        state.acp_reply_registry = Some(registry.clone());
        let state = Arc::new(state);
        let channel = "acp_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        let session = "sess_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        let (output, _messages) = mpsc::unbounded_channel();
        install_reply_sink(
            &registry,
            channel,
            ReplySink {
                turn_id: None,
                tx: None,
                session_id: session.into(),
                out_tx: output,
                owner: "client".into(),
                generation: 1,
                permission_relay: None,
            },
        );
        state
            .acp_session_automation
            .configure(channel, vec![], None);
        let update = json!({"sessionUpdate":"async_task_state_update","asyncTaskId":"t","state":"completed"});
        spawn_task(&state.acp_session_automation, channel, "t");
        let generation = state
            .acp_session_automation
            .observe(channel, &update, &accepted(channel))
            .unwrap();

        let task = tokio::spawn(run(state.clone(), channel.into(), generation));
        let payload = tokio::time::timeout(std::time::Duration::from_secs(2), incoming.recv())
            .await
            .unwrap()
            .unwrap();
        let event: Value = serde_json::from_str(&payload).unwrap();

        // Stay silent past a couple of the (test-shortened) 1s progress ticks
        // before ever answering, so the mid-wait log has time to fire.
        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;

        let response: GatewayReply = serde_json::from_value(json!({
            "schema":"openab.gateway.reply.v1", "platform":"acp", "channel":{"id":channel}, "reply_to":event["event_id"],
            "content":{"type":"text","text":"continued"}, "command":"finish_turn:end_turn"
        }))
        .unwrap();
        handle_reply(&response, &registry).await;
        tokio::time::timeout(std::time::Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();

        let out = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
        assert!(
            out.contains("background continuation still waiting for the runtime"),
            "expected a mid-wait progress log before the hard timeout: {out}"
        );
        assert!(
            !out.contains("background continuation timed out"),
            "the hard timeout must not have fired: {out}"
        );
    }

    #[test]
    fn cancellation_fences_an_automatic_dispatch_already_waiting_for_admission() {
        let automation = SessionAutomation::default();
        automation.configure("s", vec![], None);
        spawn_task(&automation, "s", "t");
        let generation = automation.observe("s", &json!({"sessionUpdate":"async_task_state_update","asyncTaskId":"t","state":"completed"}), &accepted("s")).unwrap();
        automation.cancel("s");
        let result = automation.dispatch("s", Some(generation), None, "fixture-turn", || {
            panic!("cancelled continuation must never dispatch")
        });
        assert_eq!(
            result,
            Err::<(), _>("Runtime continuation cancelled".into())
        );
    }

    #[test]
    fn opt_in_deduplicates_completion_and_cancel_fences_worker() {
        let automation = SessionAutomation::default();
        let update = json!({"sessionUpdate":"async_task_state_update","asyncTaskId":"t","state":"completed"});
        assert_eq!(automation.observe("s", &update, &accepted("s")), None);
        automation.configure("s", vec![], None);
        spawn_task(&automation, "s", "t");
        assert_eq!(automation.observe("s", &update, &accepted("s")), Some(0));
        assert_eq!(automation.observe("s", &update, &accepted("s")), None);
        assert_eq!(automation.snapshot("s")["pending"], json!(["t:completed"]));
        automation.cancel("s");
        assert_eq!(automation.snapshot("s")["pending"], json!([]));
        assert_eq!(automation.observe("s", &update, &accepted("s")), None);
    }
    #[test]
    fn unknown_foreign_and_replaced_tasks_cannot_resume() {
        let automation = SessionAutomation::default();
        automation.configure("s", vec![], None);
        automation.observe_provider_epoch("s", Some("first"));
        let done = json!({"sessionUpdate":"async_task_state_update","asyncTaskId":"t","state":"completed"});
        assert_eq!(automation.observe("s", &done, &accepted("s")), None);
        let foreign = AcceptedReply {
            channel: "s".into(),
            origin: "foreign-turn".into(),
        };
        automation.observe(
            "s",
            &json!({"sessionUpdate":"async_task_spawned","asyncTaskId":"t"}),
            &foreign,
        );
        assert_eq!(automation.observe("s", &done, &accepted("s")), None);
        spawn_task(&automation, "s", "t");
        assert_eq!(automation.observe("s", &done, &foreign), None);
        assert_eq!(automation.observe("s", &done, &accepted("other")), None);
        automation.observe_provider_epoch("s", Some("replacement"));
        assert_eq!(automation.observe("s", &done, &accepted("s")), None);
        assert_eq!(automation.snapshot("s")["pending"], json!([]));
    }
    #[test]
    fn another_admitted_turn_needs_native_task_provenance() {
        let automation = SessionAutomation::default();
        automation.configure("s", vec![], None);
        automation.observe_provider_epoch("s", Some("native-epoch"));
        automation
            .dispatch("s", None, Some((vec![], None)), "second-turn", || Ok(()))
            .unwrap();
        let second = AcceptedReply {
            channel: "s".into(),
            origin: "second-turn".into(),
        };
        spawn_task(&automation, "s", "t");
        let done = json!({"sessionUpdate":"async_task_state_update","asyncTaskId":"t","state":"completed"});
        assert_eq!(automation.observe("s", &done, &second), None);
        automation.observe("s", &json!({"sessionUpdate":"async_task_spawned","asyncTaskId":"native","_meta":{"dev.openab/taskToken":"native-reader-token","dev.openab/taskEpoch":"native-epoch"}}), &accepted("s"));
        let mut native_done = json!({"sessionUpdate":"async_task_state_update","asyncTaskId":"native","state":"completed"});
        assert_eq!(automation.observe("s", &native_done, &second), None);
        native_done["_meta"] =
            json!({"dev.openab/taskToken":"wrong-token","dev.openab/taskEpoch":"native-epoch"});
        assert_eq!(automation.observe("s", &native_done, &second), None);
        native_done["_meta"] = json!({"dev.openab/taskToken":"native-reader-token","dev.openab/taskEpoch":"native-epoch"});
        assert_eq!(automation.observe("s", &native_done, &second), Some(0));
    }
    #[test]
    fn only_native_tools_that_outlive_the_foreground_turn_schedule_continuation() {
        let automation = SessionAutomation::default();
        automation.configure("s", vec![], None);
        automation.observe_provider_epoch("s", Some("native"));
        let meta = json!({"dev.openab/taskToken":"instance","dev.openab/taskEpoch":"native"});
        let start = json!({"sessionUpdate":"tool_call","toolCallId":"exec","status":"in_progress","_meta":meta});
        automation.observe("s", &start, &accepted("s"));
        let mut done = json!({"sessionUpdate":"tool_call_update","toolCallId":"exec","status":"completed","_meta":meta});
        assert_eq!(automation.observe("s", &done, &accepted("s")), None);
        done["_meta"]["dev.openab/backgroundTool"] = json!(true);
        assert_eq!(automation.observe("s", &done, &accepted("s")), Some(0));
        assert_eq!(automation.observe("s", &done, &accepted("s")), None);
    }
    #[test]
    fn cancelled_background_task_cannot_be_reintroduced_by_late_progress() {
        let automation = SessionAutomation::default();
        automation.configure("s", vec![], None);
        automation.observe_provider_epoch("s", Some("native"));
        let meta = json!({"dev.openab/taskToken":"cancelled-instance","dev.openab/taskEpoch":"native","dev.openab/backgroundTool":true});
        let progress = json!({"sessionUpdate":"tool_call","toolCallId":"exec","status":"in_progress","_meta":meta});
        automation.observe("s", &progress, &accepted("s"));
        automation.cancel("s");
        automation
            .dispatch("s", None, Some((vec![], None)), "second-turn", || Ok(()))
            .unwrap();
        let next = AcceptedReply {
            channel: "s".into(),
            origin: "second-turn".into(),
        };
        automation.observe("s", &progress, &next);
        let done = json!({"sessionUpdate":"tool_call_update","toolCallId":"exec","status":"completed","_meta":meta});
        assert_eq!(automation.observe("s", &done, &next), None);
        assert_eq!(automation.snapshot("s")["pending"], json!([]));
    }
}
