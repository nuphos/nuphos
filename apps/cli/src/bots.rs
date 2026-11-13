//! `nuphos bots`: list your Bots in the team, or create one.

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};

use crate::cli::{row, Ctx};
use crate::render::clean;
use crate::shared::{self, label};

/// The backend's title limit, counted in UTF-16 units like zod's `max`.
const MAX_TITLE_UNITS: usize = 120;

#[derive(Debug, PartialEq)]
enum Action {
    List,
    Create(String),
}

/// A bare name must not create anything, so `--create` is required for one.
fn plan(name: Option<String>, create: bool) -> Result<Action> {
    match (name, create) {
        (None, _) => Ok(Action::List),
        (Some(name), true) => Ok(Action::Create(name)),
        (Some(name), false) => bail!(
            "`nuphos bots` only lists Bots; to create one named '{}' run `nuphos bots '{}' --create`.",
            clean(&name),
            clean(&name)
        ),
    }
}

/// The shape of an avatar name such as `01-vermeer-girl`; the backend knows which exist.
fn avatar_shape_ok(avatar: &str) -> bool {
    let bytes = avatar.as_bytes();
    bytes.len() >= 4
        && bytes.len() <= 43
        && bytes[..2].iter().all(u8::is_ascii_digit)
        && bytes[2] == b'-'
        && bytes[3..].iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// The `POST /agent/bots` body; the team goes in the query. The runtime is the
/// one a new chat would use.
fn create_body(title: &str, avatar: Option<&str>, runtime: Option<&Value>) -> Result<Value> {
    let title = title.trim();
    if title.is_empty() || title.encode_utf16().count() > MAX_TITLE_UNITS {
        bail!("A Bot's name must be 1 to {MAX_TITLE_UNITS} characters.");
    }
    let mut body = json!({ "title": title });
    if let Some(avatar) = avatar {
        if !avatar_shape_ok(avatar) {
            bail!(
                "'{}' is not an avatar name; they look like 01-vermeer-girl (see the desktop's Bot picker).",
                clean(avatar)
            );
        }
        body["avatar"] = json!(avatar);
    }
    if let Some(r) = runtime {
        body["runtimeId"] = r["id"].clone();
        body["agentRuntime"] = r["provider"].clone();
    }
    Ok(body)
}

/// `nuphos bots [NAME --create] [--avatar A] [--agent RUNTIME]`.
pub async fn bots(
    ctx: &Ctx,
    name: Option<String>,
    create: bool,
    avatar: Option<String>,
    runtime: Option<String>,
) -> Result<()> {
    let team = ctx.team["id"].as_str().unwrap_or_default().to_string();
    match plan(name, create)? {
        Action::List => list(ctx, &team).await,
        Action::Create(name) => create_bot(ctx, &team, &name, avatar.as_deref(), runtime).await,
    }
}

async fn list(ctx: &Ctx, team: &str) -> Result<()> {
    let (bots, more) = ctx.api.bots(team).await?;
    if ctx.json {
        println!("{}", serde_json::to_string_pretty(&bots)?);
    } else {
        for b in &bots {
            row(
                false,
                &[
                    b["sessionId"].as_str().unwrap_or_default(),
                    &shared::conversation_time(b),
                    &shared::conversation_title(b),
                    b["avatar"].as_str().unwrap_or_default(),
                ],
            );
        }
    }
    if more {
        eprintln!("nuphos: showing the first {} Bots; there are more.", bots.len());
    }
    Ok(())
}

async fn create_bot(ctx: &Ctx, team: &str, name: &str, avatar: Option<&str>, runtime: Option<String>) -> Result<()> {
    let runtimes = shared::active_runtimes(ctx.api.runtimes(team).await?);
    let runtime = match runtime {
        Some(wanted) => Some(shared::find(&runtimes, &wanted, "runtime")?),
        None => shared::default_runtime(&runtimes, &ctx.prefs, team, &ctx.me_id),
    };
    let body = create_body(name, avatar, runtime.as_ref())?;
    let bot = ctx.api.create_bot(team, &body).await.map_err(|e| {
        if e.status == 400 && avatar.is_some() {
            anyhow!("{e}. Avatar names are the Bot picker's faces, such as 01-vermeer-girl.")
        } else {
            e.into()
        }
    })?;
    if ctx.json {
        println!("{}", serde_json::to_string_pretty(&bot)?);
        return Ok(());
    }
    let id = bot["sessionId"].as_str().ok_or_else(|| anyhow!("The server returned no Bot id."))?;
    let on = runtime.as_ref().map_or_else(|| "the team's default runtime".to_string(), label);
    println!(
        "Created Bot {} ({}) on {on}; it runs with Full Access.",
        clean(bot["title"].as_str().unwrap_or(name)),
        clean(id)
    );
    println!("Talk to it with: nuphos exec --session {} \"...\"", clean(id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::*;
    use crate::{Args, Command};

    fn parse(args: &[&str]) -> Command {
        let mut argv = vec!["nuphos"];
        argv.extend(args);
        Args::try_parse_from(argv).unwrap().command.unwrap()
    }

    #[test]
    fn create_takes_a_name_avatar_and_agent() {
        match parse(&["bot", "Scout", "--create", "--avatar", "07-ada", "--agent", "Codex"]) {
            Command::Bots { name, create, avatar, runtime } => {
                assert_eq!(name.as_deref(), Some("Scout"));
                assert!(create);
                assert_eq!(avatar.as_deref(), Some("07-ada"));
                assert_eq!(runtime.as_deref(), Some("Codex"));
            }
            _ => panic!("not bots"),
        }
    }

    #[test]
    fn options_for_a_new_bot_need_create() {
        assert!(Args::try_parse_from(["nuphos", "bots", "Scout", "--avatar", "07-ada"]).is_err());
        assert!(Args::try_parse_from(["nuphos", "bots", "--create"]).is_err());
    }

    #[test]
    fn a_bare_name_creates_nothing() {
        assert_eq!(plan(None, false).unwrap(), Action::List);
        assert_eq!(plan(Some("Scout".into()), true).unwrap(), Action::Create("Scout".into()));
        let error = plan(Some("Scout".into()), false).unwrap_err().to_string();
        assert!(error.contains("nuphos bots 'Scout' --create"), "{error}");
    }

    #[test]
    fn the_body_carries_the_runtime_the_way_exec_does() {
        let runtime = json!({ "id": "rt1", "provider": "codex", "label": "Codex" });
        let body = create_body("  Scout ", Some("07-ada"), Some(&runtime)).unwrap();
        assert_eq!(body, json!({ "title": "Scout", "avatar": "07-ada", "runtimeId": "rt1", "agentRuntime": "codex" }));
        assert_eq!(create_body("Scout", None, None).unwrap(), json!({ "title": "Scout" }));
    }

    #[test]
    fn a_name_the_backend_would_refuse_is_caught_here() {
        assert!(create_body("   ", None, None).is_err());
        assert!(create_body(&"x".repeat(MAX_TITLE_UNITS + 1), None, None).is_err());
        assert!(create_body(&"x".repeat(MAX_TITLE_UNITS), None, None).is_ok());
        // One emoji is two UTF-16 units: 61 of them are over the limit, 60 are not.
        assert!(create_body(&"\u{1F600}".repeat(60), None, None).is_ok());
        assert!(create_body(&"\u{1F600}".repeat(61), None, None).is_err());
    }

    #[test]
    fn an_avatar_must_look_like_a_catalog_name() {
        for ok in ["01-vermeer-girl", "29-amelia-earhart", "07-ada"] {
            assert!(create_body("Scout", Some(ok), None).is_ok(), "{ok}");
        }
        for bad in ["", "ada", "7-ada", "07ada", "07-", "07-Ada", "07-a da", "../etc", "07-\u{e9}"] {
            assert!(create_body("Scout", Some(bad), None).is_err(), "{bad}");
        }
        assert!(create_body("Scout", Some(&format!("07-{}", "a".repeat(41))), None).is_err());
    }
}
