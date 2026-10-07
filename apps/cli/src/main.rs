//! `nuphos` — a terminal client for Nuphos agent conversations.

mod api;
mod app;
mod config;
mod login;
mod render;
mod transcript;

use std::io::Write;

use anyhow::{bail, Result};
use serde_json::Value;

use crate::api::Api;

const HELP: &str = "\
Usage: nuphos [command]

  nuphos           start a new conversation
  nuphos resume    pick a previous conversation to continue
  nuphos login     sign in (shared with the Nuphos desktop app)
  nuphos logout    sign out here and in the desktop app

Environment: NUPHOS_API_URL, NUPHOS_CLI_CONFIG, NUPHOS_TEAM";

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("nuphos: {e:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let command = std::env::args().nth(1).unwrap_or_default();
    match command.as_str() {
        "" | "resume" | "login" => {}
        "logout" => {
            config::write_session(&config::Session::default())?;
            println!("Signed out of Nuphos.");
            return Ok(());
        }
        "-h" | "--help" | "help" => {
            println!("{HELP}");
            return Ok(());
        }
        "-V" | "--version" => {
            println!("nuphos {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        other => bail!("unknown command '{other}'\n\n{HELP}"),
    }

    let api_url = config::api_url();
    let mut session = config::read_session();
    if command == "login" || session.token.is_none() {
        session = login::login(&api_url).await?;
        if command == "login" {
            println!("Signed in as {}.", render::clean(session.user.as_deref().unwrap_or("you")));
            return Ok(());
        }
    }
    let mut api = Api::new(api_url.clone(), session.token.clone().unwrap_or_default());
    let me = match api.me().await {
        Ok(me) => me,
        Err(e) if e.is_rejected_token() => {
            // Expired or signed out elsewhere: the desktop clears it the same way.
            config::write_session(&config::Session::default())?;
            session = login::login(&api_url).await?;
            api = Api::new(api_url, session.token.clone().unwrap_or_default());
            api.me().await?
        }
        Err(e) => return Err(e.into()),
    };
    let me_id = me["user"]["id"].as_str().or(me["id"].as_str()).unwrap_or_default().to_string();

    let mut prefs = config::read_prefs();
    let team = choose_team(&api, &mut prefs).await?;
    let team_id = team["id"].as_str().unwrap_or_default().to_string();
    let app = app::App::new(api, me_id, team, prefs).await?;
    if let Some(session_id) = app.run(command == "resume").await? {
        let web = std::env::var("NUPHOS_WEB_URL").unwrap_or_else(|_| "https://nuphos.ai".into());
        let path = render::clean(&format!("/teams/{team_id}/agent/{session_id}"));
        println!("Conversation: {}{path}", web.trim_end_matches('/'));
    }
    Ok(())
}

/// `NUPHOS_TEAM`, the team used last time, the only team, or a prompt.
async fn choose_team(api: &Api, prefs: &mut config::Prefs) -> Result<Value> {
    let teams = api.teams().await?;
    if teams.is_empty() {
        bail!("You are not a member of any Nuphos team yet. Create one in the Nuphos app first.");
    }
    let wanted = std::env::var("NUPHOS_TEAM").ok().or_else(|| prefs.team_id.clone());
    let found = wanted.and_then(|w| teams.iter().find(|t| t["id"] == w.as_str() || t["name"] == w.as_str()).cloned());
    let team = match found {
        Some(team) => team,
        None if teams.len() == 1 => teams[0].clone(),
        None => {
            println!("Choose a team:");
            for (i, t) in teams.iter().enumerate() {
                println!("  {}. {}", i + 1, render::clean(t["name"].as_str().unwrap_or_default()));
            }
            loop {
                print!("> ");
                std::io::stdout().flush()?;
                let mut line = String::new();
                if std::io::stdin().read_line(&mut line)? == 0 {
                    bail!("No team chosen");
                }
                if let Some(t) = line.trim().parse::<usize>().ok().and_then(|n| teams.get(n.wrapping_sub(1))) {
                    break t.clone();
                }
            }
        }
    };
    prefs.team_id = team["id"].as_str().map(String::from);
    config::write_prefs(prefs);
    Ok(team)
}
