//! The public session projection is assembled inside the runtime, including gateway waits.
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};

#[derive(Default)]
pub struct SessionSnapshots(
    Mutex<HashMap<String, Value>>,
    Mutex<HashMap<String, (String, u64, String)>>,
);

impl SessionSnapshots {
    pub fn should_publish(&self, channel: &str, snapshot: &Value, owner: &str) -> bool {
        let identity = (
            snapshot["epoch"].as_str().unwrap_or_default().to_string(),
            snapshot["revision"].as_u64().unwrap_or(0),
            owner.to_string(),
        );
        let mut published = self.1.lock().unwrap_or_else(|e| e.into_inner());
        if published.get(channel) == Some(&identity) {
            return false;
        }
        published.insert(channel.into(), identity);
        true
    }

    pub fn project(&self, channel: &str, provider: Value, request_pending: bool) -> Value {
        let provider_state = provider["providerState"]
            .as_str()
            .or_else(|| provider["state"].as_str())
            .unwrap_or("unknown");
        let operation = provider["operation"].as_str().unwrap_or("none");
        let permissions = provider["permissionWaits"].as_u64().unwrap_or(0);
        let tools: Vec<Value> = provider["tools"]
            .as_object()
            .map(|tools| tools.values().cloned().collect())
            .unwrap_or_default();
        let requests: Vec<Value> = provider["requests"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|request| {
                let mut request = request.clone();
                request["label"] = json!(match request["kind"].as_str() {
                    Some("plan") => "Waiting for plan approval",
                    Some("permission-grant") => "Waiting for access approval",
                    Some("authorization-rule" | "agent-permission") => "Waiting for approval",
                    Some("client-tool") => "Waiting for a tool on your device",
                    _ => "Waiting for input",
                });
                request
            })
            .collect();
        let background_tasks = provider["asyncTasks"].as_object().is_some_and(|tasks| {
            tasks.values().any(|task| {
                !matches!(
                    task["state"].as_str(),
                    Some("completed" | "failed" | "stopped")
                )
            })
        });
        let executing = provider["state"] == "active";
        let automation = provider["automation"].clone();
        let resuming = automation["running"] == true;
        let resume_pending = automation["pending"]
            .as_array()
            .is_some_and(|v| !v.is_empty());
        let active_flags = provider
            .pointer("/providerDetails/activeFlags")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let busy = resuming
            || resume_pending
            || request_pending
            || executing
            || operation != "none"
            || permissions > 0
            || !requests.is_empty();
        let (phase, label) = if operation == "cancelling"
            || (busy && provider["gateway"]["cancelling"] == true)
        {
            ("cancelling", "Stopping…".to_string())
        } else if provider["gateway"]["configuring"].as_u64().unwrap_or(0) > 0 {
            (
                "configuring",
                "Reading or updating session settings…".to_string(),
            )
        } else if operation == "loading" {
            ("loading", "Loading the session…".to_string())
        } else if let Some(request) = requests.first() {
            (
                "waiting_for_input",
                request["label"]
                    .as_str()
                    .unwrap_or("Waiting for input")
                    .to_string(),
            )
        } else if permissions > 0 {
            ("waiting_for_permission", "Waiting for approval".to_string())
        } else if provider["gateway"]["steering"].as_u64().unwrap_or(0) > 0 {
            ("steering", "Sending your message…".to_string())
        } else if resuming {
            (
                "resuming",
                "Continuing after a background task…".to_string(),
            )
        } else if resume_pending
            && automation["blockedOn"] == "connection"
            && !executing
            && !request_pending
        {
            (
                "resume_disconnected",
                "Automatic continuation paused: output connection lost".to_string(),
            )
        } else if resume_pending && !executing && !request_pending {
            (
                "resume_pending",
                "Waiting to continue after a background task…".to_string(),
            )
        } else if executing && !active_flags.is_empty() {
            (
                "provider_wait",
                format!(
                    "Runtime: {}",
                    active_flags
                        .iter()
                        .map(|v| v
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| v.to_string()))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
        } else if !matches!(
            provider_state,
            "idle" | "dormant" | "active" | "unknown" | "interrupted" | "systemError" | "notLoaded"
        ) {
            ("provider_state", format!("Runtime: {provider_state}"))
        } else if request_pending && !executing {
            match provider_state {
                "idle" => ("finishing", "Finishing the request…".to_string()),
                "interrupted" | "systemError" | "notLoaded" => (
                    "finishing",
                    "Finalizing the interrupted request…".to_string(),
                ),
                _ => ("preparing", "Preparing the session…".to_string()),
            }
        } else if executing && !tools.is_empty() {
            ("running_tools", "Running tools…".to_string())
        } else if executing {
            if provider["activity"] == "responding" {
                ("responding", "Responding…".to_string())
            } else if provider["activity"] == "thinking" {
                ("thinking", "Thinking…".to_string())
            } else {
                ("working", "Working…".to_string())
            }
        } else if operation == "prompt" {
            (
                "finishing",
                "Waiting for the runtime to finish the request…".to_string(),
            )
        } else if let Some(error) = provider
            .pointer("/gateway/lastOutcome/error/message")
            .and_then(Value::as_str)
        {
            ("failed", format!("Request failed: {error}"))
        } else if provider
            .pointer("/gateway/lastOutcome/result/stopReason")
            .and_then(Value::as_str)
            == Some("cancelled")
        {
            ("cancelled", "Stopped".to_string())
        } else if let Some(reason) = provider
            .pointer("/gateway/lastOutcome/result/stopReason")
            .and_then(Value::as_str)
            .filter(|reason| *reason != "end_turn")
        {
            (
                "stopped",
                match reason {
                    "max_tokens" => "Stopped at the output limit".to_string(),
                    "max_turn_requests" => "Stopped at the turn limit".to_string(),
                    "refusal" => "The agent declined the request".to_string(),
                    _ => format!("Stopped: {reason}"),
                },
            )
        } else if provider_state == "interrupted"
            || provider_state == "systemError"
            || provider_state == "notLoaded"
        {
            ("interrupted", "Session interrupted".to_string())
        } else if let Some(error) = automation["error"].as_str() {
            (
                "resume_failed",
                format!("Automatic continuation failed: {error}"),
            )
        } else if provider_state == "unknown" {
            ("unknown", "Runtime state is unknown".to_string())
        } else if provider_state != "idle" && provider_state != "dormant" {
            ("provider_state", format!("Runtime: {provider_state}"))
        } else if !tools.is_empty() || background_tasks {
            (
                "background_tools",
                "Background tools are still running".to_string(),
            )
        } else if provider_state == "dormant" {
            ("dormant", "Ready to start".to_string())
        } else {
            ("idle", "Ready".to_string())
        };
        let send = !busy
            && matches!(
                provider_state,
                "idle" | "dormant" | "interrupted" | "notLoaded" | "systemError"
            );
        let state = if busy {
            "active"
        } else {
            provider["state"].as_str().unwrap_or("unknown")
        };
        let mut value = json!({
            "schemaVersion": 2, "state": state, "phase": phase, "label": label,
            "providerState": provider_state, "providerEpoch": provider["epoch"],
            "operation": operation, "requestPending": request_pending,
            "providerDetails": provider["providerDetails"], "asyncTasks": provider["asyncTasks"], "automation": automation,
            "lastOutcome": provider["gateway"]["lastOutcome"],
            "permissionWaits": permissions, "tools": tools, "requests": requests,
            "actions": {"send": send, "cancel": busy && phase != "cancelling" && phase != "configuring", "steer": provider["steeringSupported"] == true && executing && !matches!(phase, "cancelling" | "configuring" | "loading"), "reply": phase != "cancelling" && requests.iter().any(|request| request["kind"] != "client-tool")}
        });
        let mut registry = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous) = registry.get(channel) {
            value["epoch"] = previous["epoch"].clone();
            value["revision"] = previous["revision"].clone();
            if value != *previous {
                value["revision"] = json!(previous["revision"].as_u64().unwrap_or(0) + 1);
            }
        } else {
            value["epoch"] = json!(uuid::Uuid::new_v4().to_string());
            value["revision"] = json!(0);
        }
        registry.insert(channel.to_string(), value.clone());
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_steering_capability_is_runtime_owned() {
        let snapshots = SessionSnapshots::default();
        assert_eq!(
            snapshots.project(
                "s",
                json!({"state":"active","steeringSupported":true}),
                true
            )["actions"]["steer"],
            true
        );
        for provider in [
            json!({"state":"active"}),
            json!({"state":"idle","steeringSupported":true}),
            json!({"state":"active","steeringSupported":true,"operation":"cancelling"}),
        ] {
            assert_eq!(
                snapshots.project("s", provider, true)["actions"]["steer"],
                false
            );
        }
        assert_eq!(
            snapshots.project("s", json!({"state":"idle","gateway":{"steering":1}}), true)["phase"],
            "steering"
        );
    }
    #[test]
    fn gateway_wait_is_visible_even_after_provider_idle() {
        let states = SessionSnapshots::default();
        let pending = states.project("a", json!({"state":"idle"}), true);
        assert_eq!(pending["phase"], "finishing");
        assert_eq!(pending["actions"]["send"], false);
        let done = states.project("a", json!({"state":"idle"}), false);
        assert_eq!(done["actions"]["send"], true);
        assert_eq!(done["epoch"], pending["epoch"]);
        assert_eq!(done["revision"], 1);
        assert_eq!(states.project("a", json!({"state":"idle"}), false), done);
    }
    #[test]
    fn background_work_is_visible_but_does_not_block_new_messages() {
        let state = SessionSnapshots::default().project(
            "a",
            json!({"state":"idle", "tools":{"t":{"id":"t","status":"in_progress"}}}),
            false,
        );
        assert_eq!(state["phase"], "background_tools");
        assert_eq!(state["actions"]["send"], true);
        assert_eq!(state["state"], "idle");
    }
    #[test]
    fn permission_cancel_and_unfamiliar_states_are_never_hidden() {
        let states = SessionSnapshots::default();
        assert_eq!(
            states.project("a", json!({"state":"active","permissionWaits":1}), true)["phase"],
            "waiting_for_permission"
        );
        let stopping = states.project(
            "a",
            json!({"state":"active","operation":"cancelling"}),
            true,
        );
        assert_eq!(stopping["phase"], "cancelling");
        assert_eq!(stopping["actions"]["cancel"], false);
        let unknown = states.project(
            "a",
            json!({"state":"unknown","providerState":"rate_limited"}),
            false,
        );
        assert_eq!(unknown["label"], "Runtime: rate_limited");
        assert_eq!(unknown["actions"]["send"], false);
        let unknown_pending = states.project(
            "a",
            json!({"state":"unknown","providerState":"rate_limited","operation":"prompt"}),
            true,
        );
        assert_eq!(unknown_pending["label"], "Runtime: rate_limited");
        assert_eq!(unknown_pending["actions"]["send"], false);
    }
}
