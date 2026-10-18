//! Runtime-owned session facts. Transports and clients only read this projection.
use serde_json::{json, Value};
use std::sync::Mutex;

/// Part A of the shells-panel work: neither agent adapter this gateway talks to
/// (claude-agent-acp 0.74.0, codex-acp 1.1.4) calls the ACP spec's `terminal/*`
/// RPCs. Both instead report terminal activity inline on ordinary
/// `tool_call`/`tool_call_update` notifications — a `ToolCallContent::Terminal`
/// content item (`{"type":"terminal","terminalId":...}`) plus live output/exit
/// bundled onto the notification's own `_meta` (`terminal_info`,
/// `terminal_output`, `terminal_output_delta`, `terminal_exit`) — a convention
/// originated by Zed (`_meta.terminal_output` at `initialize`; see
/// `connection.rs`), not the spec's `terminal/*` RPC family. This extracts that
/// into the tool's tracked state so it survives the ACP passthrough forwarding
/// (`ChatAdapter::forward_agent_update`) into the same `runtime_state` snapshot
/// the client already reads (`AppState::acp_session_snapshot`).
fn terminal_id_from_content(update: &Value) -> Option<&str> {
    update
        .get("content")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                (item.get("type").and_then(Value::as_str) == Some("terminal"))
                    .then(|| item.get("terminalId").and_then(Value::as_str))
                    .flatten()
            })
        })
}

fn apply_terminal_fields(tool: &mut Value, update: &Value) {
    // The initial `tool_call` carries the terminal id via `ToolCallContent::Terminal`
    // (or `_meta.terminal_info.terminalId`); later `tool_call_update`s for the same
    // call only carry incremental `_meta` fields (delta/exit) and must be matched
    // against the id already recorded on this tool.
    let terminal_id = terminal_id_from_content(update)
        .or_else(|| {
            update
                .pointer("/_meta/terminal_info/terminalId")
                .and_then(Value::as_str)
        })
        .map(str::to_owned)
        .or_else(|| tool["terminal"]["terminalId"].as_str().map(str::to_owned));
    let Some(terminal_id) = terminal_id else {
        return;
    };
    if tool["terminal"].as_object().is_none() {
        tool["terminal"] = json!({});
    }
    let terminal = tool["terminal"].as_object_mut().unwrap();
    terminal.insert("terminalId".into(), json!(terminal_id));
    if let Some(command) = update
        .pointer("/_meta/terminal_info/command")
        .and_then(Value::as_str)
        .or_else(|| update["title"].as_str())
    {
        terminal.insert("command".into(), json!(command));
    }
    if let Some(output) = update
        .pointer("/_meta/terminal_output")
        .and_then(Value::as_str)
    {
        terminal.insert("output".into(), json!(output));
    }
    if let Some(delta) = update
        .pointer("/_meta/terminal_output_delta")
        .and_then(Value::as_str)
    {
        let mut appended = terminal
            .get("output")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        appended.push_str(delta);
        terminal.insert("output".into(), json!(appended));
    }
    // An exited terminal leaves the snapshot with its tool, so a tracked one is running.
    terminal.insert("status".into(), json!("running"));
}

/// A cancelled turn's tools are over: adapters kill them without reporting a
/// terminal status, so left alone they would show as running forever. Tools an
/// earlier turn left running in the background are not part of it and stay.
fn end_cancelled_tools(snapshot: &mut Value) {
    snapshot["tools"]
        .as_object_mut()
        .unwrap()
        .retain(|_, tool| tool["background"] == true);
}

/// A call still pending when the provider stops never started (e.g. a streamed
/// tool_use that was abandoned), so no result will ever close it. Only calls
/// seen executing can outlive the turn.
fn end_unstarted_tools(snapshot: &mut Value) {
    snapshot["tools"]
        .as_object_mut()
        .unwrap()
        .retain(|_, tool| tool["status"] != "pending");
}

pub struct SessionState(Mutex<Value>);

impl Default for SessionState {
    fn default() -> Self {
        Self(Mutex::new(json!({
            "epoch": uuid::Uuid::new_v4().to_string(), "revision": 0,
            "state": "unknown", "providerState": "unknown", "operation": "none",
            "tools": {}, "asyncTasks": {}, "providerDetails": null, "permissionWaits": 0, "activity": "working"
        })))
    }
}

impl SessionState {
    /// A successful ACP creation/load acknowledges a session ready for its first
    /// prompt. Do not overwrite a lifecycle notification already received.
    pub fn initialized(&self) {
        self.change(|snapshot| {
            if snapshot["state"] == "unknown" && snapshot["providerState"] == "unknown" {
                snapshot["state"] = json!("idle");
                snapshot["providerState"] = json!("idle");
                snapshot["providerDetails"] = json!({"source":"session_initialized"});
            }
        });
    }
    pub fn snapshot(&self) -> Value {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn change(&self, update: impl FnOnce(&mut Value)) {
        let mut snapshot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let previous = snapshot.clone();
        update(&mut snapshot);
        if *snapshot != previous {
            snapshot["revision"] = json!(previous["revision"].as_u64().unwrap_or(0) + 1);
        }
    }

    pub fn set(&self, state: &str) {
        self.change(|snapshot| {
            snapshot["state"] = json!(state);
            if state == "interrupted" {
                end_unstarted_tools(snapshot);
                snapshot["operation"] = json!("none");
                snapshot["permissionWaits"] = json!(0);
            }
            snapshot["providerState"] = json!(state);
        });
    }

    pub fn operation(&self, operation: &str) {
        self.change(|snapshot| {
            if snapshot["operation"] == "cancelling" && operation != "cancelling" {
                end_cancelled_tools(snapshot);
            }
            snapshot["operation"] = json!(operation);
            if operation == "prompt" {
                // Keep background tools visible across turns, but reset model activity.
                snapshot["activity"] = json!("working");
            }
        });
    }

    pub fn permission_wait(&self, waiting: bool) {
        self.change(|snapshot| {
            let count = snapshot["permissionWaits"].as_u64().unwrap_or(0);
            snapshot["permissionWaits"] = json!(if waiting {
                count + 1
            } else {
                count.saturating_sub(1)
            });
        });
    }

    /// Stamp provenance at the native reader, before prompt/idle routes can change.
    pub fn observe_and_stamp(&self, params: Option<&mut Value>) {
        let Some(params) = params else { return };
        let previous = params
            .pointer("/update/toolCallId")
            .and_then(Value::as_str)
            .map(|id| self.snapshot()["tools"][id].clone());
        self.observe(Some(params));
        let Some(update) = params.get_mut("update") else {
            return;
        };
        let snapshot = self.snapshot();
        if matches!(
            update["sessionUpdate"].as_str(),
            Some(
                "async_task_spawned" | "async_task_state_update" | "tool_call" | "tool_call_update"
            )
        ) {
            // Clear subprocess provenance even when a malformed event has no identifier.
            if !update["_meta"].is_object() {
                update["_meta"] = json!({});
            }
            update["_meta"]["dev.openab/taskToken"] = Value::Null;
            update["_meta"]["dev.openab/taskEpoch"] = snapshot["epoch"].clone();
            update["_meta"]["dev.openab/backgroundTool"] = json!(false);
        }
        let (record, background) = match update["sessionUpdate"].as_str() {
            Some("async_task_spawned" | "async_task_state_update") => {
                let Some(id) = update["asyncTaskId"].as_str() else {
                    return;
                };
                (snapshot["asyncTasks"][id].clone(), false)
            }
            Some("tool_call" | "tool_call_update") => {
                let Some(id) = update["toolCallId"].as_str() else {
                    return;
                };
                let current = &snapshot["tools"][id];
                let record = if current.is_null() {
                    previous.unwrap_or(Value::Null)
                } else {
                    current.clone()
                };
                let explicit_task = snapshot["asyncTasks"]
                    .as_object()
                    .is_some_and(|tasks| tasks.values().any(|task| task["toolCallId"] == id));
                let background = record["background"] == true && !explicit_task;
                (record, background)
            }
            _ => return,
        };
        // Never trust provenance supplied by the subprocess itself.
        if !update["_meta"].is_object() {
            update["_meta"] = json!({});
        }
        update["_meta"]["dev.openab/taskToken"] = record["ownershipToken"].clone();
        update["_meta"]["dev.openab/taskEpoch"] = snapshot["epoch"].clone();
        update["_meta"]["dev.openab/backgroundTool"] = json!(background);
    }

    pub fn observe(&self, params: Option<&Value>) {
        let Some(update) = params.and_then(|p| p.get("update")) else {
            return;
        };
        self.change(|snapshot| {
            match update["sessionUpdate"].as_str() {
                Some("session_info_update") => {
                    let provider = update
                        .pointer("/_meta/ai.nuphos~1sessionState/state")
                        .or_else(|| update.pointer("/_meta/codex/threadStatus/type"))
                        .and_then(Value::as_str);
                    if let Some(details) = update
                        .pointer("/_meta/codex/threadStatus")
                        .or_else(|| update.pointer("/_meta/ai.nuphos~1sessionState"))
                    {
                        snapshot["providerDetails"] = details.clone();
                    }
                    if let Some(provider) = provider {
                        // Preserve unfamiliar provider states instead of silently hiding them.
                        snapshot["providerState"] = json!(provider);
                        if provider == "idle" && snapshot["operation"] == "cancelling" {
                            end_cancelled_tools(snapshot);
                            snapshot["operation"] = json!("none");
                        }
                        if matches!(
                            provider,
                            "idle" | "notLoaded" | "systemError" | "interrupted"
                        ) {
                            end_unstarted_tools(snapshot);
                        }
                        if provider == "idle" {
                            for tool in snapshot["tools"].as_object_mut().unwrap().values_mut() {
                                tool["background"] = json!(true);
                            }
                        }
                        snapshot["state"] = json!(match provider {
                            "active" => "active",
                            "idle" => "idle",
                            "notLoaded" | "systemError" | "interrupted" => "interrupted",
                            _ => "unknown",
                        });
                    }
                }
                Some("async_task_spawned" | "async_task_state_update") => {
                    if let Some(id) = update["asyncTaskId"].as_str() {
                        let tasks = snapshot["asyncTasks"].as_object_mut().unwrap();
                        let task = tasks.entry(id).or_insert_with(|| json!({"id":id}));
                        for key in ["state", "name", "toolCallId"] {
                            if let Some(v) = update[key].as_str() {
                                task[key] = json!(v);
                            }
                        }
                        if update["sessionUpdate"] == "async_task_spawned" {
                            if task["state"] != "running" || !task["ownershipToken"].is_string() {
                                task["ownershipToken"] = json!(uuid::Uuid::new_v4().to_string());
                            }
                            task["state"] = json!("running");
                        }
                    }
                }
                // The agent's own slash commands, as it last listed them; it
                // sends the whole list each time it changes.
                Some("available_commands_update") => {
                    if let Some(commands) = update["availableCommands"].as_array() {
                        snapshot["commands"] = agent_commands(commands);
                    }
                }
                Some("agent_thought_chunk") => snapshot["activity"] = json!("thinking"),
                Some("agent_message_chunk") => snapshot["activity"] = json!("responding"),
                Some("tool_call" | "tool_call_update") => {
                    if let Some(id) = update["toolCallId"].as_str() {
                        let status = update["status"].as_str();
                        // A terminal exit ends the tool even when no terminal status follows.
                        if matches!(
                            status,
                            Some("completed" | "failed" | "cancelled" | "stopped")
                        ) || update.pointer("/_meta/terminal_exit").is_some()
                        {
                            snapshot["tools"].as_object_mut().unwrap().remove(id);
                        } else {
                            let tools = snapshot["tools"].as_object_mut().unwrap();
                            // Only open calls and updates for known calls describe live work.
                            if update["sessionUpdate"] == "tool_call" || tools.contains_key(id) {
                                let tool = tools
                                    .entry(id)
                                    .or_insert_with(|| json!({"id": id, "status": "pending", "ownershipToken":uuid::Uuid::new_v4().to_string()}));
                                for field in ["status", "title", "kind"] {
                                    if let Some(value) = update[field].as_str() {
                                        tool[field] = json!(value);
                                    }
                                }
                                apply_terminal_fields(tool, update);
                            }
                        }
                    }
                }
                _ => {}
            }
        });
    }
}

/// The agent's slash commands as clients read them: `{ name, description, hint? }`,
/// with ACP's `input.hint` flattened. The list is the agent's to define and rides
/// on every snapshot, so it is bounded here: an entry without a usable name is
/// dropped, text is cut, and the list stops at 100 entries.
fn agent_commands(commands: &[Value]) -> Value {
    let cut = |text: &str, max: usize| text.chars().take(max).collect::<String>();
    commands
        .iter()
        .filter_map(|command| {
            let name = command["name"]
                .as_str()
                .filter(|name| (1..=64).contains(&name.chars().count()))?;
            let mut entry = json!({
                "name": name,
                "description": cut(command["description"].as_str().unwrap_or(""), 200),
            });
            if let Some(hint) = command.pointer("/input/hint").and_then(Value::as_str) {
                entry["hint"] = json!(cut(hint, 100));
            }
            Some(entry)
        })
        .take(100)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_agents_slash_commands_are_kept_as_last_listed() {
        let state = SessionState::default();
        let listed = json!([
            {"name":"review","description":"Review the diff","input":{"hint":"branch"}},
            {"name":"compact"},
            {"name":"","description":"empty name"},
            {"description":"no name"}
        ]);
        state.observe(Some(&json!({"update":{"sessionUpdate":"available_commands_update","availableCommands":listed}})));
        assert_eq!(
            state.snapshot()["commands"],
            json!([
                {"name":"review","description":"Review the diff","hint":"branch"},
                {"name":"compact","description":""}
            ])
        );
        state.observe(Some(
            &json!({"update":{"sessionUpdate":"available_commands_update","availableCommands":[]}}),
        ));
        assert_eq!(state.snapshot()["commands"], json!([]));
    }

    #[test]
    fn the_agents_slash_commands_are_bounded() {
        let state = SessionState::default();
        let long = "x".repeat(1_000);
        let mut listed: Vec<Value> = (0..150)
            .map(|i| json!({"name": format!("c{i}"), "description": long, "input": {"hint": long}}))
            .collect();
        listed.insert(0, json!({"name": long, "description": "name too long"}));
        state.observe(Some(&json!({"update":{"sessionUpdate":"available_commands_update","availableCommands":listed}})));
        let commands = state.snapshot()["commands"].as_array().unwrap().clone();
        assert_eq!(commands.len(), 100);
        assert_eq!(commands[0]["name"], "c0");
        assert_eq!(commands[0]["description"].as_str().unwrap().len(), 200);
        assert_eq!(commands[0]["hint"].as_str().unwrap().len(), 100);
    }
    #[test]
    fn initialization_ack_does_not_override_an_earlier_native_lifecycle() {
        let new_session = SessionState::default();
        new_session.initialized();
        assert_eq!(new_session.snapshot()["state"], "idle");
        let resumed = SessionState::default();
        resumed.set("active");
        let before = resumed.snapshot();
        resumed.initialized();
        assert_eq!(resumed.snapshot(), before);
    }
    #[test]
    fn background_tools_remain_visible_without_reopening_execution() {
        let state = SessionState::default();
        state.set("active");
        state.observe(Some(&json!({"update":{"sessionUpdate":"tool_call","toolCallId":"bg","status":"in_progress"}})));
        state.set("idle");
        assert_eq!(state.snapshot()["state"], "idle");
        assert_eq!(state.snapshot()["tools"]["bg"]["status"], "in_progress");
        state.observe(Some(&json!({"update":{"sessionUpdate":"tool_call_update","toolCallId":"bg","status":"completed"}})));
        assert_eq!(state.snapshot()["state"], "idle");
        assert!(state.snapshot()["tools"].as_object().unwrap().is_empty());
    }
    #[test]
    fn a_tool_call_that_never_started_does_not_outlive_its_turn() {
        let state = SessionState::default();
        state.set("active");
        state.observe(Some(&json!({"update":{"sessionUpdate":"tool_call","toolCallId":"abandoned","status":"pending","title":"Terminal","content":[{"type":"terminal","terminalId":"abandoned"}]}})));
        state.observe(Some(&json!({"update":{"sessionUpdate":"tool_call","toolCallId":"bg","status":"in_progress"}})));
        state.observe(Some(&json!({"update":{"sessionUpdate":"session_info_update","_meta":{"ai.nuphos/sessionState":{"state":"idle"}}}})));
        let tools = state.snapshot()["tools"].clone();
        assert_eq!(
            tools.as_object().unwrap().keys().collect::<Vec<_>>(),
            vec!["bg"]
        );
        assert_eq!(tools["bg"]["background"], true);
    }
    #[test]
    fn a_tool_call_that_never_started_does_not_survive_an_interruption() {
        let pending = json!({"update":{"sessionUpdate":"tool_call","toolCallId":"abandoned","status":"pending","content":[{"type":"terminal","terminalId":"abandoned"}]}});
        for provider in ["notLoaded", "systemError", "interrupted"] {
            let state = SessionState::default();
            state.set("active");
            state.observe(Some(&pending));
            state.observe(Some(&json!({"update":{"sessionUpdate":"session_info_update","_meta":{"ai.nuphos/sessionState":{"state":provider}}}})));
            assert!(
                state.snapshot()["tools"].as_object().unwrap().is_empty(),
                "{provider}"
            );
        }
        let state = SessionState::default();
        state.set("active");
        state.observe(Some(&pending));
        state.set("interrupted");
        assert!(state.snapshot()["tools"].as_object().unwrap().is_empty());
    }
    #[test]
    fn a_tool_call_that_already_exited_is_never_tracked() {
        let state = SessionState::default();
        state.observe(Some(&json!({"update":{"sessionUpdate":"tool_call","toolCallId":"t","status":"in_progress","content":[{"type":"terminal","terminalId":"term"}],"_meta":{"terminal_exit":{"exitCode":0}}}})));
        assert!(state.snapshot()["tools"].as_object().unwrap().is_empty());
    }
    #[test]
    fn cancelling_a_turn_keeps_an_earlier_turns_background_tool() {
        let state = SessionState::default();
        state.operation("prompt");
        state.observe(Some(&json!({"update":{"sessionUpdate":"tool_call","toolCallId":"bg","status":"in_progress"}})));
        state.operation("none");
        state.set("idle");
        state.observe(Some(&json!({"update":{"sessionUpdate":"session_info_update","_meta":{"ai.nuphos/sessionState":{"state":"idle"}}}})));
        state.operation("prompt");
        state.observe(Some(
            &json!({"update":{"sessionUpdate":"tool_call","toolCallId":"t","status":"pending"}}),
        ));
        state.operation("cancelling");
        state.operation("none");
        let tools = state.snapshot()["tools"].clone();
        assert_eq!(
            tools.as_object().unwrap().keys().collect::<Vec<_>>(),
            vec!["bg"]
        );
    }
    #[test]
    fn cancelling_a_turn_ends_its_tools_whichever_signal_comes_first() {
        let running = json!({"update":{"sessionUpdate":"tool_call","toolCallId":"t","status":"pending","content":[{"type":"terminal","terminalId":"term"}]}});

        let state = SessionState::default();
        state.operation("prompt");
        state.observe(Some(&running));
        state.operation("cancelling");
        state.operation("none");
        assert!(state.snapshot()["tools"].as_object().unwrap().is_empty());

        let state = SessionState::default();
        state.operation("prompt");
        state.observe(Some(&running));
        state.operation("cancelling");
        state.observe(Some(&json!({"update":{"sessionUpdate":"session_info_update","_meta":{"ai.nuphos/sessionState":{"state":"idle"}}}})));
        assert!(state.snapshot()["tools"].as_object().unwrap().is_empty());
        assert_eq!(state.snapshot()["operation"], "none");
    }
    #[test]
    fn provider_idle_does_not_hide_a_pending_prompt_or_permission() {
        let state = SessionState::default();
        state.operation("prompt");
        state.permission_wait(true);
        state.set("idle");
        let waiting = state.snapshot();
        assert_eq!(waiting["operation"], "prompt");
        assert_eq!(waiting["permissionWaits"], 1);
        state.permission_wait(false);
        state.operation("none");
        assert!(state.snapshot()["revision"].as_u64() > waiting["revision"].as_u64());
    }
    #[test]
    fn unfamiliar_provider_state_is_retained_and_revision_is_monotonic() {
        let state = SessionState::default();
        let first = state.snapshot();
        state.observe(Some(&json!({"update":{"sessionUpdate":"session_info_update","_meta":{"codex":{"threadStatus":{"type":"waiting_for_input"}}}}})));
        let next = state.snapshot();
        assert_eq!(next["providerState"], "waiting_for_input");
        assert_eq!(next["state"], "unknown");
        assert_eq!(next["revision"], 1);
        assert_eq!(first["epoch"], next["epoch"]);
        assert_ne!(next["epoch"], SessionState::default().snapshot()["epoch"]);
    }
    #[test]
    fn native_task_provenance_survives_turns_and_changes_on_id_reuse() {
        let state = SessionState::default();
        let mut spawned = json!({"update":{"sessionUpdate":"async_task_spawned","asyncTaskId":"t","_meta":{"dev.openab/taskToken":"forged"}}});
        state.observe_and_stamp(Some(&mut spawned));
        let token = spawned["update"]["_meta"]["dev.openab/taskToken"].clone();
        assert!(token.is_string());
        assert_ne!(token, "forged");
        state.operation("prompt");
        let mut done = json!({"update":{"sessionUpdate":"async_task_state_update","asyncTaskId":"t","state":"completed"}});
        state.observe_and_stamp(Some(&mut done));
        assert_eq!(done["update"]["_meta"]["dev.openab/taskToken"], token);
        state.observe_and_stamp(Some(&mut spawned));
        assert_ne!(spawned["update"]["_meta"]["dev.openab/taskToken"], token);
        let mut unknown = json!({"update":{"sessionUpdate":"async_task_state_update","asyncTaskId":"unknown","state":"completed","_meta":{"dev.openab/taskToken":"forged"}}});
        state.observe_and_stamp(Some(&mut unknown));
        assert!(unknown["update"]["_meta"]["dev.openab/taskToken"].is_null());
    }
    #[test]
    fn malformed_task_events_cannot_keep_subprocess_provenance() {
        let state = SessionState::default();
        for kind in [
            "async_task_spawned",
            "async_task_state_update",
            "tool_call",
            "tool_call_update",
        ] {
            for id in [Value::Null, json!(42)] {
                let mut event = json!({"update": {
                    "sessionUpdate": kind, "toolCallId": id, "asyncTaskId": id,
                    "_meta": {"dev.openab/taskToken": "forged", "dev.openab/taskEpoch": "forged", "dev.openab/backgroundTool": true}
                }});
                state.observe_and_stamp(Some(&mut event));
                assert!(event["update"]["_meta"]["dev.openab/taskToken"].is_null());
                assert_eq!(
                    event["update"]["_meta"]["dev.openab/taskEpoch"],
                    state.snapshot()["epoch"]
                );
                assert_eq!(event["update"]["_meta"]["dev.openab/backgroundTool"], false);
            }
        }
    }

    #[test]
    fn native_background_tool_completion_keeps_provenance_after_removal() {
        let state = SessionState::default();
        let mut start = json!({"update":{"sessionUpdate":"tool_call","toolCallId":"exec","status":"in_progress"}});
        state.observe_and_stamp(Some(&mut start));
        let token = start["update"]["_meta"]["dev.openab/taskToken"].clone();
        assert!(token.is_string());
        state.observe(Some(&json!({"update":{"sessionUpdate":"session_info_update","_meta":{"codex":{"threadStatus":{"type":"idle"}}}}})));
        state.operation("prompt");
        let mut done = json!({"update":{"sessionUpdate":"tool_call_update","toolCallId":"exec","status":"completed"}});
        state.observe_and_stamp(Some(&mut done));
        assert_eq!(done["update"]["_meta"]["dev.openab/taskToken"], token);
        assert_eq!(done["update"]["_meta"]["dev.openab/backgroundTool"], true);
        assert!(state.snapshot()["tools"].as_object().unwrap().is_empty());
        state.observe_and_stamp(Some(&mut done));
        assert!(done["update"]["_meta"]["dev.openab/taskToken"].is_null());
        assert_eq!(done["update"]["_meta"]["dev.openab/backgroundTool"], false);
    }

    #[test]
    fn zed_terminal_meta_is_tracked_on_the_tool_call() {
        let state = SessionState::default();
        state.observe(Some(&json!({"update": {
            "sessionUpdate": "tool_call",
            "toolCallId": "t1",
            "title": "ls -la",
            "status": "in_progress",
            "content": [{"type": "terminal", "terminalId": "term-1"}],
            "_meta": {"terminal_output": "line one\n"}
        }})));
        let snapshot = state.snapshot();
        let terminal = &snapshot["tools"]["t1"]["terminal"];
        assert_eq!(terminal["terminalId"], "term-1");
        assert_eq!(terminal["command"], "ls -la");
        assert_eq!(terminal["output"], "line one\n");
        assert_eq!(terminal["status"], "running");

        state.observe(Some(&json!({"update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "t1",
            "status": "in_progress",
            "_meta": {"terminal_output_delta": "line two\n"}
        }})));
        let snapshot = state.snapshot();
        assert_eq!(
            snapshot["tools"]["t1"]["terminal"]["output"],
            "line one\nline two\n"
        );

        state.observe(Some(&json!({"update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "t1",
            "status": "in_progress",
            "_meta": {"terminal_exit": {"exitCode": 0}}
        }})));
        assert!(state.snapshot()["tools"].as_object().unwrap().is_empty());
    }
}
