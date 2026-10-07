//! Conversation messages as AI SDK UI messages (`{ id, role, parts }`), and the
//! reducer that folds UI-message-stream frames into the assistant message —
//! a port of the iOS app's `UIStreamReducer`. Messages stay JSON so whatever
//! the server sent is sent back unchanged.

use serde_json::{json, Map, Value};

pub fn user_message(text: &str) -> Value {
    json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "role": "user",
        "parts": [{ "type": "text", "text": text, "state": "done" }],
    })
}

pub fn assistant_message() -> Value {
    json!({ "id": uuid::Uuid::new_v4().to_string(), "role": "assistant", "parts": [] })
}

pub fn role(message: &Value) -> &str {
    message["role"].as_str().unwrap_or_default()
}

pub fn parts(message: &Value) -> &[Value] {
    message["parts"].as_array().map(Vec::as_slice).unwrap_or_default()
}

fn parts_mut(message: &mut Value) -> &mut Vec<Value> {
    if !message["parts"].is_array() {
        message["parts"] = json!([]);
    }
    message["parts"].as_array_mut().expect("parts is an array")
}

pub fn part_type(part: &Value) -> &str {
    part["type"].as_str().unwrap_or_default()
}

/// `tool-<name>` and `dynamic-tool` (the SDK) or `tool` (the backend's
/// persisted form).
pub fn is_tool(part: &Value) -> bool {
    let t = part_type(part);
    t == "tool" || t == "dynamic-tool" || t.starts_with("tool-")
}

pub fn tool_name(part: &Value) -> &str {
    part["toolName"].as_str().or_else(|| part_type(part).strip_prefix("tool-")).unwrap_or("tool")
}

pub fn tool_state(part: &Value) -> &str {
    match part["state"].as_str() {
        Some(s) => s,
        None if !part["output"].is_null() => "output-available",
        None => "input-available",
    }
}

pub fn is_tool_settled(part: &Value) -> bool {
    matches!(tool_state(part), "output-available" | "output-error" | "output-denied")
}

/// What goes back on `POST /agent/chat`: no reasoning, no Atlas-only
/// bookkeeping parts, and tool parts in the SDK's shape.
pub fn for_wire(message: &Value) -> Value {
    let mut out = message.clone();
    let wire: Vec<Value> = parts(message)
        .iter()
        .filter(|p| !matches!(part_type(p), "reasoning" | "memory-ingest" | "memory-provenance" | "transfer-download"))
        .map(|p| {
            if !is_tool(p) {
                return p.clone();
            }
            let mut p = p.clone();
            let dynamic = part_type(&p) == "dynamic-tool" || p["dynamic"].as_bool() == Some(true);
            let name = tool_name(&p).to_string();
            let o = p.as_object_mut().expect("tool part is an object");
            o.remove("inputText");
            o.remove("dynamic");
            if dynamic {
                o.insert("type".into(), json!("dynamic-tool"));
                o.insert("toolName".into(), json!(name));
            } else {
                o.insert("type".into(), json!(format!("tool-{name}")));
                o.remove("toolName");
            }
            p
        })
        .collect();
    out["parts"] = Value::Array(wire);
    out
}

/// The `POST /agent/chat` body: the suffix from the last user message on,
/// since the server already has everything before it.
pub fn chat_body(session_id: &str, team_id: &str, base_index: usize, messages: &[Value]) -> Value {
    let last_user = messages.iter().rposition(|m| role(m) == "user").unwrap_or(0);
    let window: Vec<Value> = messages[last_user..].iter().map(for_wire).collect();
    let mut body = json!({
        "id": session_id,
        "teamId": team_id,
        "messages": window,
        "streamId": uuid::Uuid::new_v4().to_string(),
        "resume": false,
        "resumeFrom": 0,
        "clientCapabilities": { "localTools": false },
    });
    if base_index + last_user > 0 {
        body["baseIndex"] = json!(base_index + last_user);
    }
    body
}

/// The call in the latest reply that is waiting for approval.
pub fn pending_approval(messages: &[Value]) -> Option<(usize, usize)> {
    let mi = messages.iter().rposition(|m| role(m) == "assistant")?;
    let pi = parts(&messages[mi]).iter().position(|p| is_tool(p) && tool_state(p) == "approval-requested")?;
    Some((mi, pi))
}

/// Records the decision on the tool part itself, which is how the server
/// receives it.
pub fn answer_approval(messages: &mut [Value], (mi, pi): (usize, usize), approved: bool) {
    let part = &mut messages[mi]["parts"][pi];
    part["state"] = json!("approval-responded");
    part["approval"]["approved"] = json!(approved);
}

/// What a frame did to the turn.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    None,
    Finished,
    Error(String),
}

/// Applies one SDK frame to `message`. Atlas frames are handled by the caller.
pub fn apply(message: &mut Value, frame: &Value) -> Outcome {
    let kind = frame["type"].as_str().unwrap_or_default();
    match kind {
        "start" => {
            if let Some(id) = frame["messageId"].as_str().filter(|s| !s.is_empty()) {
                message["id"] = json!(id);
            }
        }
        "start-step" => parts_mut(message).push(json!({ "type": "step-start" })),
        "reset-step" => {
            let parts = parts_mut(message);
            if let Some(last) = parts.iter().rposition(|p| part_type(p) == "step-start") {
                parts.truncate(last + 1);
            }
        }
        "text-start" | "reasoning-start" => {
            let kind = &kind[..kind.len() - "-start".len()];
            close_open_parts(message, kind);
            parts_mut(message).push(json!({ "type": kind, "id": frame["id"], "text": "", "state": "streaming" }));
        }
        "text-delta" | "reasoning-delta" => {
            let kind = &kind[..kind.len() - "-delta".len()];
            close_open_parts(message, kind);
            let delta = frame["delta"].as_str().unwrap_or_default();
            match streaming_index(message, kind, &frame["id"]) {
                Some(i) => {
                    let part = &mut parts_mut(message)[i];
                    let text = format!("{}{delta}", part["text"].as_str().unwrap_or_default());
                    part["text"] = json!(text);
                }
                None => parts_mut(message)
                    .push(json!({ "type": kind, "id": frame["id"], "text": delta, "state": "streaming" })),
            }
        }
        "text-end" | "reasoning-end" => {
            let kind = &kind[..kind.len() - "-end".len()];
            if let Some(i) = streaming_index(message, kind, &frame["id"]) {
                parts_mut(message)[i]["state"] = json!("done");
            }
        }
        "tool-input-start" => {
            close_open_parts(message, "tool");
            update_tool(message, frame, |t| {
                t.insert("toolName".into(), frame["toolName"].clone());
                t.insert("state".into(), json!("input-streaming"));
                if frame["dynamic"].as_bool() == Some(true) {
                    t.insert("dynamic".into(), json!(true));
                }
                copy(t, frame, "title");
            });
        }
        "tool-input-delta" => {
            let delta = frame["inputTextDelta"].as_str().unwrap_or_default().to_string();
            update_tool(message, frame, |t| {
                let raw = format!("{}{delta}", t.get("inputText").and_then(Value::as_str).unwrap_or_default());
                if let Ok(input) = serde_json::from_str::<Value>(&raw) {
                    t.insert("input".into(), input);
                }
                t.insert("inputText".into(), json!(raw));
            });
        }
        "tool-input-available" => {
            if find_tool(message, &frame["toolCallId"]).is_none() {
                close_open_parts(message, "tool");
            }
            update_tool(message, frame, |t| {
                // The Claude Code runtime re-sends the call with the command as
                // its name; the first name is the real one.
                let unnamed = t.get("toolName").and_then(Value::as_str).is_none_or(|n| n.is_empty() || n == "tool");
                if unnamed {
                    t.insert("toolName".into(), frame["toolName"].clone());
                }
                if frame["dynamic"].as_bool() == Some(true) {
                    t.insert("dynamic".into(), json!(true));
                }
                t.insert("state".into(), json!("input-available"));
                t.insert("input".into(), frame["input"].clone());
                t.remove("inputText");
                copy(t, frame, "title");
                copy(t, frame, "providerExecuted");
                if !frame["providerMetadata"].is_null() {
                    t.insert("callProviderMetadata".into(), frame["providerMetadata"].clone());
                }
            });
        }
        "tool-input-error" | "tool-output-error" => update_tool(message, frame, |t| {
            t.insert("state".into(), json!("output-error"));
            copy(t, frame, "errorText");
        }),
        "tool-approval-request" => update_tool(message, frame, |t| {
            t.insert("state".into(), json!("approval-requested"));
            if let Some(id) = frame["approvalId"].as_str() {
                t.insert("approval".into(), json!({ "id": id }));
            }
        }),
        "tool-output-available" => update_tool(message, frame, |t| {
            t.insert("state".into(), json!("output-available"));
            t.insert("output".into(), frame["output"].clone());
            copy(t, frame, "providerExecuted");
        }),
        "tool-output-denied" => update_tool(message, frame, |t| {
            t.insert("state".into(), json!("output-denied"));
        }),
        "file" | "source-url" | "source-document" => parts_mut(message).push(frame.clone()),
        "error" => return Outcome::Error(frame["errorText"].as_str().unwrap_or("The agent hit an error.").to_string()),
        "finish" | "abort" => {
            finish_streaming_parts(message);
            return Outcome::Finished;
        }
        _ if kind.starts_with("data-") => {
            let id = &frame["id"];
            let existing = (!id.is_null())
                .then(|| parts(message).iter().position(|p| part_type(p) == kind && &p["id"] == id))
                .flatten();
            let part = json!({ "type": kind, "id": id, "data": frame["data"] });
            match existing {
                Some(i) => parts_mut(message)[i] = part,
                None if frame["transient"].as_bool() != Some(true) => parts_mut(message).push(part),
                None => {}
            }
        }
        _ => {}
    }
    Outcome::None
}

/// Marks streaming text and reasoning done — on finish, and when a turn ends
/// without one.
pub fn finish_streaming_parts(message: &mut Value) {
    for part in parts_mut(message) {
        if part["state"] == "streaming" {
            part["state"] = json!("done");
        }
    }
}

/// Runtimes that skip `text-end` / `reasoning-end` still switch kinds between
/// parts; whatever was open is finished so the next delta starts a new part.
fn close_open_parts(message: &mut Value, except: &str) {
    for part in parts_mut(message) {
        let t = part_type(part);
        if (t == "text" || t == "reasoning") && t != except && part["state"] == "streaming" {
            part["state"] = json!("done");
        }
    }
}

fn streaming_index(message: &Value, kind: &str, id: &Value) -> Option<usize> {
    let parts = parts(message);
    if !id.is_null() {
        if let Some(i) = parts.iter().rposition(|p| part_type(p) == kind && &p["id"] == id) {
            return Some(i);
        }
    }
    parts.iter().rposition(|p| part_type(p) == kind && p["state"] == "streaming")
}

fn find_tool(message: &Value, call_id: &Value) -> Option<usize> {
    parts(message).iter().position(|p| is_tool(p) && &p["toolCallId"] == call_id)
}

fn update_tool(message: &mut Value, frame: &Value, change: impl FnOnce(&mut Map<String, Value>)) {
    let call_id = frame["toolCallId"].clone();
    let i = match find_tool(message, &call_id) {
        Some(i) => i,
        None => {
            let parts = parts_mut(message);
            parts
                .push(json!({ "type": "tool", "toolCallId": call_id, "toolName": "tool", "state": "input-streaming" }));
            parts.len() - 1
        }
    };
    let part = parts_mut(message)[i].as_object_mut().expect("tool part is an object");
    change(part);
    if part.get("toolName").is_none_or(Value::is_null) {
        part.insert("toolName".into(), json!("tool"));
    }
}

fn copy(target: &mut Map<String, Value>, frame: &Value, key: &str) {
    if !frame[key].is_null() {
        target.insert(key.into(), frame[key].clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(frames: &[Value]) -> Value {
        let mut m = assistant_message();
        for f in frames {
            apply(&mut m, f);
        }
        m
    }

    #[test]
    fn text_deltas_join_and_kind_switches_close_parts() {
        let m = run(&[
            json!({"type":"reasoning-delta","delta":"hmm"}),
            json!({"type":"text-delta","delta":"Hel"}),
            json!({"type":"text-delta","delta":"lo"}),
        ]);
        let p = parts(&m);
        assert_eq!(p[0]["state"], "done");
        assert_eq!(p[1]["text"], "Hello");
        assert_eq!(p[1]["state"], "streaming");
    }

    #[test]
    fn tool_lifecycle_and_wire_shape() {
        let m = run(&[
            json!({"type":"tool-input-start","toolCallId":"c1","toolName":"bash"}),
            json!({"type":"tool-input-available","toolCallId":"c1","toolName":"aws sts","input":{"command":"aws sts get-caller-identity"}}),
            json!({"type":"tool-approval-request","toolCallId":"c1","approvalId":"openab:w1"}),
        ]);
        let tool = &parts(&m)[0];
        assert_eq!(tool_name(tool), "bash");
        assert_eq!(tool_state(tool), "approval-requested");
        assert_eq!(tool["approval"]["id"], "openab:w1");

        let wire = for_wire(&m);
        let tool = &parts(&wire)[0];
        assert_eq!(tool["type"], "tool-bash");
        assert!(tool.get("toolName").is_none());
    }

    #[test]
    fn wire_drops_reasoning_and_keeps_dynamic_tool_names() {
        let m = json!({"id":"a","role":"assistant","parts":[
            {"type":"reasoning","text":"x"},
            {"type":"dynamic-tool","toolName":"mcp__x","toolCallId":"c","state":"output-available","output":1}
        ]});
        let wire = for_wire(&m);
        assert_eq!(parts(&wire).len(), 1);
        assert_eq!(parts(&wire)[0]["toolName"], "mcp__x");
    }

    #[test]
    fn transient_data_parts_are_not_kept() {
        let m = run(&[
            json!({"type":"data-x","transient":true,"data":1}),
            json!({"type":"data-y","id":"1","data":1}),
            json!({"type":"data-y","id":"1","data":2}),
        ]);
        assert_eq!(parts(&m).len(), 1);
        assert_eq!(parts(&m)[0]["data"], 2);
    }
}
