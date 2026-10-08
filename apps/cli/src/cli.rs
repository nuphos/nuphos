//! Every TUI action as a command that needs no terminal, so scripts and other
//! agents can drive Nuphos: `exec` sends a message and prints the reply, and
//! `team`, `runtime` and `model` list choices without a value and switch with
//! one. `--json` prints machine-readable output.

use std::io::Write;

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use tokio::sync::mpsc::unbounded_channel;

use crate::api::{Api, StreamEvent};
use crate::config::{self, Prefs};
use crate::render::clean;
use crate::shared::{self, label, option_of_kind};
use crate::transcript as tx;

/// The signed-in context every command runs in.
pub struct Ctx {
    pub api: Api,
    pub me_id: String,
    pub team: Value,
    pub prefs: Prefs,
    pub json: bool,
}

impl Ctx {
    fn team_id(&self) -> String {
        self.team["id"].as_str().unwrap_or_default().to_string()
    }

    async fn runtimes(&self) -> Result<Vec<Value>> {
        Ok(shared::active_runtimes(self.api.runtimes(&self.team_id()).await?))
    }

    fn print_json(&self, value: &Value) {
        println!("{}", serde_json::to_string_pretty(value).unwrap_or_default());
    }
}

fn row(current: bool, columns: &[&str]) {
    println!("{} {}", if current { "*" } else { " " }, columns.iter().map(|c| clean(c)).collect::<Vec<_>>().join("  "));
}

/// `nuphos team [NAME]`: list teams, or make NAME the default.
pub async fn team(ctx: &mut Ctx, name: Option<String>) -> Result<()> {
    let teams = ctx.api.teams().await?;
    if let Some(name) = name {
        let team = shared::find(&teams, &name, "team")?;
        shared::remember_team(&mut ctx.prefs, &team);
        if ctx.json {
            ctx.print_json(&team);
        } else {
            println!("Default team: {}", label(&team));
        }
        return Ok(());
    }
    if ctx.json {
        ctx.print_json(&json!({ "current": ctx.team["id"], "teams": teams }));
        return Ok(());
    }
    for t in &teams {
        row(t["id"] == ctx.team["id"], &[&label(t), t["id"].as_str().unwrap_or_default()]);
    }
    Ok(())
}

/// `nuphos runtime [NAME] [--session ID]`: list the team's agents, or pick
/// NAME for new conversations, or move a conversation to it.
pub async fn runtime(ctx: &mut Ctx, name: Option<String>, session: Option<String>) -> Result<()> {
    let runtimes = ctx.runtimes().await?;
    let current = match &session {
        Some(id) => {
            let detail = ctx.api.conversation(&ctx.team_id(), id).await?;
            detail["runtimeId"].as_str().and_then(|rid| runtimes.iter().find(|r| r["id"] == rid)).cloned()
        }
        None => shared::default_runtime(&runtimes, &ctx.prefs, &ctx.team_id(), &ctx.me_id),
    };
    let Some(name) = name else {
        if ctx.json {
            ctx.print_json(&json!({ "current": current.as_ref().map(|r| &r["id"]), "runtimes": runtimes }));
            return Ok(());
        }
        for r in &runtimes {
            let is_current = current.as_ref().is_some_and(|c| c["id"] == r["id"]);
            row(is_current, &[&label(r), &shared::runtime_detail(r), r["id"].as_str().unwrap_or_default()]);
        }
        return Ok(());
    };
    let target = shared::find(&runtimes, &name, "agent")?;
    let target_id = target["id"].as_str().unwrap_or_default().to_string();
    match session {
        None => {
            ctx.prefs.runtime_ids.insert(ctx.team_id(), target_id);
            config::write_prefs(&ctx.prefs);
            if ctx.json {
                ctx.print_json(&target);
            } else {
                println!("New conversations in {} run on {}", label(&ctx.team), label(&target));
            }
        }
        Some(id) => {
            let mode = shared::move_mode(current.as_ref(), &target);
            let moved = ctx.api.move_runtime(&ctx.team_id(), &id, &target_id, mode).await?;
            if ctx.json {
                ctx.print_json(&moved);
            } else {
                println!("Moved to {} ({mode})", label(&target));
            }
        }
    }
    Ok(())
}

/// `nuphos model [VALUE] [--effort E] [--session ID]`. With a session it is
/// that conversation's setting; without one it is the default the next new
/// conversation starts with, as on the desktop (a team setting for a Cloud
/// agent).
pub async fn model(
    ctx: &mut Ctx,
    value: Option<String>,
    effort: Option<String>,
    session: Option<String>,
) -> Result<()> {
    let team = ctx.team_id();
    if let Some(session) = session {
        let mut config = ctx.api.model_config(&team, &session).await?;
        for (kind, wanted) in [("model", &value), ("effort", &effort)] {
            let Some(wanted) = wanted else { continue };
            let option = option_of_kind(&config, kind).ok_or_else(|| anyhow!("This agent has no {kind} setting."))?;
            let id = option["id"].as_str().unwrap_or(kind).to_string();
            let value = choice(option["options"].as_array(), wanted, kind)?;
            config = ctx.api.set_model_config(&team, &session, &id, &value).await?;
        }
        if ctx.json {
            ctx.print_json(&config);
        } else {
            print_options(&config);
        }
        return Ok(());
    }

    let runtimes = ctx.runtimes().await?;
    let runtime = shared::default_runtime(&runtimes, &ctx.prefs, &team, &ctx.me_id)
        .ok_or_else(|| anyhow!("This team has no active agents."))?;
    let runtime_id = runtime["id"].as_str().unwrap_or_default().to_string();
    if value.is_none() && effort.is_none() {
        let catalog = ctx.api.runtime_models(&team, &runtime_id, None).await?;
        if ctx.json {
            ctx.print_json(&json!({ "runtime": runtime, "catalog": catalog }));
            return Ok(());
        }
        let scope = if runtime["kind"] == "local" { "set in the desktop app" } else { "team setting" };
        println!("Default for new conversations on {} ({scope}):", label(&runtime));
        let current = runtime["defaults"]["model"].as_str().or(catalog["controls"]["modelId"].as_str());
        for m in catalog["models"].as_array().into_iter().flatten() {
            let id = m["id"].as_str().unwrap_or_default();
            row(Some(id) == current, &[id, m["name"].as_str().unwrap_or_default()]);
        }
        if let Some(effort) = runtime["defaults"]["effort"].as_str() {
            println!("effort: {}", clean(effort));
        }
        return Ok(());
    }
    if runtime["kind"] == "local" {
        bail!(
            "{} is a local agent; change its default model in the desktop app, or pass --session after the first message.",
            label(&runtime)
        );
    }
    let mut defaults = runtime["defaults"].clone();
    if !defaults.is_object() {
        defaults = json!({});
    }
    if let Some(v) = value {
        defaults["model"] = json!(v);
    }
    if let Some(e) = effort {
        defaults["effort"] = json!(e);
    }
    ctx.api.set_runtime_defaults(&team, &runtime_id, &defaults).await?;
    if ctx.json {
        ctx.print_json(&defaults);
    } else {
        println!("New conversations on {} start with {}", label(&runtime), clean(&defaults.to_string()));
    }
    Ok(())
}

/// A model-config value by value or display name.
fn choice(options: Option<&Vec<Value>>, wanted: &str, kind: &str) -> Result<String> {
    let options = options.cloned().unwrap_or_default();
    let lower = wanted.to_lowercase();
    options
        .iter()
        .find(|o| o["value"] == wanted || o["name"].as_str().is_some_and(|n| n.to_lowercase() == lower))
        .and_then(|o| o["value"].as_str().map(String::from))
        .ok_or_else(|| {
            let values: Vec<&str> = options.iter().filter_map(|o| o["value"].as_str()).collect();
            anyhow!("No {kind} '{}'. Choose one of: {}", clean(wanted), values.join(", "))
        })
}

fn print_options(config: &Value) {
    for option in config["options"].as_array().into_iter().flatten() {
        println!("{}:", clean(option["name"].as_str().or(option["id"].as_str()).unwrap_or_default()));
        for v in option["options"].as_array().into_iter().flatten() {
            let value = v["value"].as_str().unwrap_or_default();
            row(option["currentValue"] == value, &[value, v["name"].as_str().unwrap_or_default()]);
        }
    }
}

/// `nuphos conversations`: recent conversations, newest first.
pub async fn conversations(ctx: &Ctx) -> Result<()> {
    let list = ctx.api.conversations(&ctx.team_id(), "mine").await?;
    if ctx.json {
        ctx.print_json(&json!(list));
        return Ok(());
    }
    for c in &list {
        row(
            false,
            &[
                c["sessionId"].as_str().unwrap_or_default(),
                &shared::conversation_time(c),
                &shared::conversation_title(c),
            ],
        );
    }
    Ok(())
}

/// `nuphos stop --session ID`: stops the reply in progress.
pub async fn stop(ctx: &Ctx, session: &str) -> Result<()> {
    ctx.api.cancel_runtime(&ctx.team_id(), session).await?;
    if !ctx.json {
        println!("Stopping the reply in {}", clean(session));
    }
    Ok(())
}

/// `nuphos exec PROMPT`: sends one message and prints the reply. The reply
/// text goes to stdout and tool activity to stderr; `--json` prints every
/// stream event instead. A command that needs approval is denied unless
/// `--approve` is given. Exit status: 0, 1 on error, 2 when an approval was
/// denied.
pub async fn exec(
    ctx: &mut Ctx,
    prompt: String,
    session: Option<String>,
    runtime: Option<String>,
    approve: bool,
) -> Result<i32> {
    let team = ctx.team_id();
    let (session_id, mut messages, base_index, first) = match &session {
        Some(id) => {
            let detail = ctx.api.conversation(&team, id).await?;
            let messages = detail["messages"].as_array().cloned().unwrap_or_default();
            (id.clone(), messages, detail["messagesFirstIndex"].as_u64().unwrap_or(0) as usize, false)
        }
        None => (uuid::Uuid::new_v4().to_string(), Vec::new(), 0, true),
    };
    if let Some(at) = tx::pending_approval(&messages) {
        tx::answer_approval(&mut messages, at, false);
    }
    messages.push(tx::user_message(&prompt));

    let mut body = tx::chat_body(&session_id, &team, base_index, &messages);
    if first {
        let runtimes = ctx.runtimes().await?;
        let runtime = match runtime {
            Some(name) => Some(shared::find(&runtimes, &name, "agent")?),
            None => shared::default_runtime(&runtimes, &ctx.prefs, &team, &ctx.me_id),
        };
        body["permissionMode"] = json!("auto");
        if let Some(r) = runtime {
            body["runtimeId"] = r["id"].clone();
            body["agentRuntime"] = r["provider"].clone();
        }
    } else if runtime.is_some() {
        bail!("--runtime picks the agent for a new conversation; use `nuphos runtime NAME --session ID` to move one.");
    }

    let (sender, mut rx) = unbounded_channel();
    let mut current = body["streamId"].as_str().unwrap_or_default().to_string();
    tokio::spawn({
        let api = ctx.api.clone();
        let sender = sender.clone();
        async move { api.chat(body, sender).await }
    });

    let mut assistant: Option<usize> = None;
    let mut ends_with_newline = true;
    let mut denied = false;
    let mut error = None;
    let stdout = std::io::stdout();
    while let Some(event) = rx.recv().await {
        match event {
            StreamEvent::Frame(id, frame) if id == current => {
                if ctx.json {
                    println!("{frame}");
                }
                let kind = frame["type"].as_str().unwrap_or_default().to_string();
                if kind.starts_with("atlas-") || kind == "phase" || kind == "runtime-state" {
                    continue;
                }
                if kind == "error" {
                    error = frame["errorText"].as_str().map(String::from);
                    continue;
                }
                let i = *assistant.get_or_insert_with(|| {
                    messages.push(tx::assistant_message());
                    messages.len() - 1
                });
                tx::apply(&mut messages[i], &frame);
                if ctx.json {
                    continue;
                }
                match kind.as_str() {
                    "text-delta" => {
                        let text: String = frame["delta"]
                            .as_str()
                            .unwrap_or_default()
                            .split('\n')
                            .map(clean)
                            .collect::<Vec<_>>()
                            .join("\n");
                        if !text.is_empty() {
                            ends_with_newline = text.ends_with('\n');
                            let mut out = stdout.lock();
                            let _ = out.write_all(text.as_bytes());
                            let _ = out.flush();
                        }
                    }
                    "tool-output-available" | "tool-output-error" | "tool-output-denied" => {
                        if let Some(part) = tool_part(&messages[i], &frame) {
                            eprintln!("{}", tool_line(part));
                        }
                    }
                    _ => {}
                }
                // Answer an approval right away, then follow the continuation.
                if let Some(at) = tx::pending_approval(&messages) {
                    let part = &messages[at.0]["parts"][at.1];
                    let command = part["input"]["command"]
                        .as_str()
                        .map(String::from)
                        .unwrap_or_else(|| part["input"].to_string());
                    eprintln!("? approval needed:\n{}", clean_block(&command));
                    eprintln!(
                        "  → {}",
                        if approve { "approved (--approve)" } else { "denied (pass --approve to allow)" }
                    );
                    denied |= !approve;
                    tx::answer_approval(&mut messages, at, approve);
                    let mut next = tx::chat_body(&session_id, &team, base_index, &messages);
                    next["continueAfterInterruption"] = json!(true);
                    next["resumeReason"] = json!("approval-decision");
                    current = next["streamId"].as_str().unwrap_or_default().to_string();
                    let api = ctx.api.clone();
                    let sender = sender.clone();
                    tokio::spawn(async move { api.chat(next, sender).await });
                }
            }
            StreamEvent::Ended(id, failure) if id == current => {
                if failure.is_some() {
                    error = failure;
                }
                break;
            }
            _ => {}
        }
    }

    if !ctx.json && !ends_with_newline {
        println!();
    }
    if ctx.json {
        println!("{}", json!({ "type": "nuphos-session", "sessionId": session_id, "teamId": team }));
    } else {
        eprintln!("session {session_id}");
    }
    if let Some(error) = error {
        eprintln!("nuphos: {}", clean(&error));
        return Ok(1);
    }
    Ok(if denied { 2 } else { 0 })
}

fn tool_part<'a>(message: &'a Value, frame: &Value) -> Option<&'a Value> {
    tx::parts(message).iter().find(|p| tx::is_tool(p) && p["toolCallId"] == frame["toolCallId"])
}

fn tool_line(part: &Value) -> String {
    let mark = match tx::tool_state(part) {
        "output-available" => "✓",
        "output-denied" => "⊘",
        _ => "✗",
    };
    let title = part["title"].as_str().unwrap_or_else(|| tx::tool_name(part));
    let command = part["input"]["command"].as_str().and_then(|c| c.lines().next()).unwrap_or_default();
    let mut line = clean(&format!("{mark} {title}  {command}"));
    if let Some(error) = part["errorText"].as_str() {
        line.push_str(&format!("\n  └ {}", clean(error)));
    }
    line
}

fn clean_block(text: &str) -> String {
    text.lines().map(|l| format!("  │ {}", clean(l))).collect::<Vec<_>>().join("\n")
}
