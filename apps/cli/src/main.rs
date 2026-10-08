//! `nuphos` — a terminal client for Nuphos agent conversations.

mod api;
mod app;
mod cli;
mod config;
mod login;
mod render;
mod shared;
mod transcript;
mod update;

use std::io::{IsTerminal, Read};

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};

use crate::api::Api;

/// A terminal client for Nuphos. Without a command it opens the interactive
/// TUI; every TUI action is also a command for scripts and other agents.
#[derive(Parser)]
#[command(name = "nuphos", version)]
struct Args {
    /// Team id or name. Defaults to the team used last.
    #[arg(long, global = true, env = "NUPHOS_TEAM")]
    team: Option<String>,
    /// Print JSON instead of text.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Send a message without the TUI and print the reply (reads stdin if no PROMPT).
    Exec {
        prompt: Option<String>,
        /// Continue this conversation instead of starting one.
        #[arg(long)]
        session: Option<String>,
        /// Agent for a new conversation (id or label).
        #[arg(long)]
        runtime: Option<String>,
        /// Approve commands that need approval (otherwise they are denied).
        #[arg(long)]
        approve: bool,
    },
    /// Open the TUI on a conversation, or pick one.
    Resume { session: Option<String> },
    /// List recent conversations.
    Conversations,
    /// List teams, make TEAM the default, or create it with --create.
    Team {
        name: Option<String>,
        /// Create a team named NAME and make it the default.
        #[arg(long, requires = "name")]
        create: bool,
    },
    /// List agents, pick one for new conversations (or move --session to it),
    /// add a Cloud agent with --create, or sign one in with --login.
    Runtime {
        name: Option<String>,
        #[arg(long)]
        session: Option<String>,
        /// Add a Nuphos-managed Cloud agent for provider NAME (claude-code, codex, grok, antigravity) and sign it in.
        #[arg(long, requires = "name", conflicts_with_all = ["session", "login"])]
        create: bool,
        /// Sign the Cloud agent NAME in to its provider account.
        #[arg(long, requires = "name", conflicts_with = "session")]
        login: bool,
    },
    /// Show or set the model and reasoning effort (of --session, or for new conversations).
    Model {
        value: Option<String>,
        #[arg(long)]
        effort: Option<String>,
        #[arg(long)]
        session: Option<String>,
    },
    /// Stop the reply in progress.
    Stop {
        #[arg(long)]
        session: String,
    },
    /// Sign in through the browser (shared with the desktop app).
    Login,
    /// Sign out here and in the desktop app.
    Logout,
    /// Install the newest release over this binary.
    Update,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    match run(args).await {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("nuphos: {}", render::clean(&format!("{e:#}")));
            std::process::exit(1);
        }
    }
}

async fn run(args: Args) -> Result<i32> {
    let interactive = matches!(args.command, None | Some(Command::Resume { .. }));
    if interactive && !(std::io::stdin().is_terminal() && std::io::stdout().is_terminal()) {
        bail!("the TUI needs a terminal; use `nuphos exec` to send a message from a script");
    }
    match &args.command {
        Some(Command::Logout) => {
            config::write_session(&config::Session::default())?;
            println!("Signed out of Nuphos.");
            return Ok(0);
        }
        Some(Command::Update) => return update::update().await,
        Some(Command::Login) => {
            let session = login::login(&config::api_url()).await?;
            println!("Signed in as {}.", render::clean(session.user.as_deref().unwrap_or("you")));
            return Ok(0);
        }
        _ => {}
    }

    let api = sign_in(interactive).await?;
    let me = api.me().await?;
    let me_id = me["user"]["id"].as_str().or(me["id"].as_str()).unwrap_or_default().to_string();
    let mut prefs = config::read_prefs();
    if let Some(Command::Team { name: Some(name), create: true }) = &args.command {
        let team = shared::create_team(&api, &mut prefs, name).await?;
        if args.json {
            println!("{}", serde_json::to_string_pretty(&team)?);
        } else {
            println!("Created team {}; it is now the default.", shared::label(&team));
        }
        return Ok(0);
    }
    let team = shared::resolve_team(&api, &mut prefs, args.team.as_deref(), interactive).await?;
    let mut ctx = cli::Ctx { api, me_id, team, prefs, json: args.json };

    match args.command {
        None | Some(Command::Resume { .. }) => {
            let start = match args.command {
                Some(Command::Resume { session }) => app::Start::Resume(session),
                _ => app::Start::New,
            };
            let team_id = ctx.team["id"].as_str().unwrap_or_default().to_string();
            let app = app::App::new(ctx.api, ctx.me_id, ctx.team, ctx.prefs).await?;
            if let Some(session_id) = app.run(start).await? {
                let web = std::env::var("NUPHOS_WEB_URL").unwrap_or_else(|_| "https://nuphos.ai".into());
                let path = render::clean(&format!("/teams/{team_id}/agent/{session_id}"));
                println!("Conversation: {}{path}", web.trim_end_matches('/'));
                println!("Continue with: nuphos resume {}", render::clean(&session_id));
            }
            Ok(0)
        }
        Some(Command::Exec { prompt, session, runtime, approve }) => {
            let prompt = match prompt.filter(|p| p != "-") {
                Some(p) => p,
                None => {
                    let mut text = String::new();
                    std::io::stdin().read_to_string(&mut text)?;
                    text
                }
            };
            if prompt.trim().is_empty() {
                bail!("nothing to send: pass a PROMPT or pipe one on stdin");
            }
            cli::exec(&mut ctx, prompt.trim().to_string(), session, runtime, approve).await
        }
        Some(Command::Conversations) => cli::conversations(&ctx).await.map(|_| 0),
        Some(Command::Team { name, .. }) => cli::team(&mut ctx, name).await.map(|_| 0),
        Some(Command::Runtime { name: Some(provider), create: true, .. }) => {
            cli::create_runtime(&mut ctx, &provider).await.map(|_| 0)
        }
        Some(Command::Runtime { name: Some(name), login: true, .. }) => {
            cli::login_runtime(&ctx, &name).await.map(|_| 0)
        }
        Some(Command::Runtime { name, session, .. }) => cli::runtime(&mut ctx, name, session).await.map(|_| 0),
        Some(Command::Model { value, effort, session }) => {
            cli::model(&mut ctx, value, effort, session).await.map(|_| 0)
        }
        Some(Command::Stop { session }) => cli::stop(&ctx, &session).await.map(|_| 0),
        Some(Command::Login | Command::Logout | Command::Update) => Ok(0),
    }
}

/// The desktop's session, checked with `/auth/me`. The TUI signs in through
/// the browser when there is none; commands fail instead, since nobody may be
/// there to finish a browser sign-in.
async fn sign_in(interactive: bool) -> Result<Api> {
    let api_url = config::api_url();
    let session = config::read_session();
    if let Some(token) = session.token {
        let api = Api::new(api_url.clone(), token);
        match api.me().await {
            Ok(_) => return Ok(api),
            // Expired or signed out elsewhere: cleared, as the desktop does.
            Err(e) if e.is_rejected_token() => config::write_session(&config::Session::default())?,
            Err(e) => return Err(e.into()),
        }
    }
    if !interactive {
        bail!("not signed in; run `nuphos login` (the sign-in is shared with the desktop app)");
    }
    let session = login::login(&api_url).await?;
    Ok(Api::new(api_url, session.token.unwrap_or_default()))
}
