//! `nuphos` — a terminal client for Nuphos agent conversations.

mod agent;
mod api;
mod app;
mod cli;
mod config;
mod login;
mod render;
mod secret;
mod shared;
mod transcript;
mod update;

use std::io::{IsTerminal, Read};

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use serde_json::Value;

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
        #[arg(long = "agent", alias = "runtime")]
        runtime: Option<String>,
        /// Approve commands that need approval (otherwise they are denied).
        #[arg(long)]
        approve: bool,
    },
    /// Open the TUI on a conversation, or pick one.
    Resume { session: Option<String> },
    /// List recent conversations, or find them by a word in the title or first message.
    Conversations { query: Option<String> },
    /// List teams, make TEAM the default, or create it with --create.
    Team {
        name: Option<String>,
        /// Create a team named NAME and make it the default.
        #[arg(long, requires = "name")]
        create: bool,
    },
    /// List agents (what conversations run on, such as Claude Code; find conversations with
    /// `nuphos conversations`), pick one for new conversations (or move --session to it),
    /// add a Cloud agent with --create, or sign one in with --login.
    #[command(name = "agents", alias = "runtime")]
    Runtime {
        name: Option<String>,
        #[arg(long)]
        session: Option<String>,
        /// Add a Nuphos-managed Cloud agent for provider NAME (claude-code, codex, grok, antigravity, opencode) and sign it in.
        #[arg(long, requires = "name", conflicts_with_all = ["session", "login"])]
        create: bool,
        /// Sign the Cloud agent NAME in to its provider account.
        #[arg(long, requires = "name", conflicts_with = "session")]
        login: bool,
    },
    /// Show or set a conversation's model and reasoning effort (--session), or list the agent's models.
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
    /// Run this computer's Claude Code and Codex as local agents, as the desktop app does.
    Agent {
        /// Join Nuphos with a one-time token instead of signing in. Pass `-` and pipe the token
        /// to stdin, or set `NUPHOS_JOIN_TOKEN`, so it stays out of the shell history. Later
        /// runs need neither.
        #[arg(long, value_name = "TOKEN")]
        join: Option<String>,
    },
    /// Sign in, from Nuphos Desktop's sign-in when there is one, else through the browser,
    /// or with a code approved on another device when there is no browser here.
    Login {
        /// Sign in with a code approved on another device, even if this one has a browser.
        #[arg(long, conflicts_with = "token")]
        device: bool,
        /// Use an agent token from nuphos.ai/settings/tokens. Pass `-` and pipe it to stdin,
        /// so it stays out of the shell history. `NUPHOS_CLI_TOKEN` works without saving it.
        #[arg(long, value_name = "TOKEN")]
        token: Option<String>,
    },
    /// List the CLI and agent tokens you have signed in with, or revoke one.
    Token {
        #[command(subcommand)]
        command: TokenCommand,
    },
    /// Change the name or avatar this agent token's messages show (agent tokens only).
    AgentProfile {
        /// The name its messages show.
        #[arg(long, required_unless_present = "avatar")]
        name: Option<String>,
        /// A PNG, JPEG or WebP file, or an http(s) URL to download it from.
        #[arg(long, value_name = "FILE|URL")]
        avatar: Option<String>,
    },
    /// Sign out of the CLI (Nuphos Desktop stays signed in).
    Logout,
    /// Show who is signed in and where the session token is kept.
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
    /// Install the newest release over this binary.
    Update,
}

#[derive(Subcommand)]
enum TokenCommand {
    /// Device sign-ins and agent tokens, newest first.
    List,
    /// Revoke the token with this id; whatever uses it is signed out.
    Revoke { id: String },
}

#[derive(Subcommand)]
enum AuthCommand {
    /// Who is signed in, and where the session token is kept.
    Status,
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
        Some(Command::Auth { command }) => return auth(command),
        Some(Command::Agent { join }) => {
            let join = agent::join_token(join.as_deref())?;
            // A joined computer has its own credential; only the session needs signing in.
            if join.is_none() && !agent::joined() {
                sign_in(std::io::stdin().is_terminal()).await?;
            }
            return agent::run(join).await;
        }
        Some(Command::Login { device, token }) => {
            let api_url = config::api_url();
            let session = match token.as_deref() {
                Some(token) => login::with_token(&api_url, &read_secret(token)?).await?,
                None => login::login(&api_url, *device).await?,
            };
            println!("Signed in as {}.", who(&session));
            return Ok(0);
        }
        Some(Command::Token { command }) => {
            let (api, _, _) = sign_in(false).await?;
            return token(&api, command, args.json).await;
        }
        Some(Command::AgentProfile { name, avatar }) => {
            let (api, _, _) = sign_in(false).await?;
            return agent_profile(&api, name.as_deref(), avatar.as_deref(), args.json).await;
        }
        Some(Command::Resume { session }) => return tui(app::Start::Resume(session.clone()), args.team).await,
        None => return tui(app::Start::New, args.team).await,
        _ => {}
    }

    let (api, me, teams) = sign_in(false).await?;
    let me_id = shared::user_id(&me);
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
    let team = shared::pick_team(&teams, &prefs, args.team.as_deref())?;
    if args.team.is_none() {
        shared::remember_team(&mut prefs, &team);
    }
    let mut ctx = cli::Ctx { api, me_id, team, prefs, json: args.json };

    match args.command {
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
        Some(Command::Conversations { query }) => cli::conversations(&ctx, query.as_deref()).await.map(|_| 0),
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
        Some(
            Command::Agent { .. }
            | Command::Login { .. }
            | Command::Token { .. }
            | Command::AgentProfile { .. }
            | Command::Logout
            | Command::Auth { .. }
            | Command::Update
            | Command::Resume { .. },
        )
        | None => Ok(0),
    }
}

/// `nuphos auth status`: read locally, without checking the token with the
/// backend. There is deliberately no command that prints the token: the
/// keychain trusts this binary, so it would hand the token to any process.
fn auth(command: &AuthCommand) -> Result<i32> {
    let session = config::read_session();
    if session.token.is_none() {
        eprintln!("nuphos: not signed in; run `nuphos login`");
        return Ok(1);
    }
    match command {
        AuthCommand::Status => {
            println!("Signed in as {}", who(&session));
            println!("API: {}", config::api_url());
            println!("Token: {}", config::token_storage(&session));
        }
    }
    Ok(0)
}

/// "Grok Bot, an agent of Yuanlin" for an agent token, else the user. Not
/// known locally for `NUPHOS_CLI_TOKEN`, which nothing has checked yet.
fn who(session: &config::Session) -> String {
    if session.from_env {
        return "whoever NUPHOS_CLI_TOKEN belongs to (not checked locally; `nuphos team` checks it)".to_string();
    }
    let user = session.user_info.as_ref().and_then(|u| u["email"].as_str()).or(session.user.as_deref());
    let user = render::clean(user.unwrap_or("unknown"));
    match &session.cli_token {
        Some(t) if t["kind"] == "agent" => {
            format!("{}, an agent of {user}", render::clean(t["name"].as_str().unwrap_or("?")))
        }
        _ => user,
    }
}

/// `-` reads the value from stdin, so it never lands in the shell history.
fn read_secret(value: &str) -> Result<String> {
    let value = if value == "-" {
        let mut text = String::new();
        std::io::stdin().read_to_string(&mut text)?;
        text
    } else {
        value.to_string()
    };
    let value = value.trim().to_string();
    if value.is_empty() {
        bail!("no token given");
    }
    Ok(value)
}

/// `nuphos token list | revoke ID`.
async fn token(api: &Api, command: &TokenCommand, json: bool) -> Result<i32> {
    match command {
        TokenCommand::List => {
            let tokens = api.cli_tokens().await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&tokens)?);
                return Ok(0);
            }
            for t in &tokens {
                let used = t["lastUsedAt"].as_str().unwrap_or("never");
                println!(
                    "{}  {:<8}  {}  last used {}",
                    render::clean(t["id"].as_str().unwrap_or_default()),
                    render::clean(t["kind"].as_str().unwrap_or_default()),
                    render::clean(t["name"].as_str().unwrap_or_default()),
                    render::clean(used),
                );
            }
        }
        TokenCommand::Revoke { id } => {
            if id.len() != 24 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
                bail!("not a token id; `nuphos token list` shows them");
            }
            api.revoke_cli_token(id).await?;
            println!("Revoked {}.", render::clean(id));
        }
    }
    Ok(0)
}

/// `nuphos agent-profile --name NAME --avatar FILE|URL`: the backend accepts
/// this only from an agent token, and only for that token.
async fn agent_profile(api: &Api, name: Option<&str>, avatar: Option<&str>, json: bool) -> Result<i32> {
    let mut profile = Value::Null;
    if let Some(name) = name {
        profile = api.set_agent_name(name.trim()).await?["cliToken"].take();
    }
    if let Some(avatar) = avatar {
        profile = api.set_agent_avatar(read_avatar(avatar).await?).await?["cliToken"].take();
    }
    if json {
        println!("{}", serde_json::to_string_pretty(&profile)?);
    } else {
        let name = render::clean(profile["name"].as_str().unwrap_or_default());
        match profile["avatarUrl"].as_str() {
            Some(url) => println!("This agent is now {name}, with avatar {}.", render::clean(url)),
            None => println!("This agent is now {name}."),
        }
    }
    Ok(0)
}

/// The backend's avatar limit; reading stops once an image is larger.
const MAX_AVATAR_BYTES: usize = 2 * 1024 * 1024;

/// An avatar image from a file or an http(s) URL, at most `MAX_AVATAR_BYTES`.
async fn read_avatar(source: &str) -> Result<Vec<u8>> {
    let too_large = || anyhow::anyhow!("the image is over 2 MB");
    let mut image = Vec::new();
    if source.starts_with("https://") || source.starts_with("http://") {
        let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build()?;
        let mut response = client.get(source).send().await?.error_for_status()?;
        while let Some(chunk) = response.chunk().await? {
            if image.len() + chunk.len() > MAX_AVATAR_BYTES {
                return Err(too_large());
            }
            image.extend_from_slice(&chunk);
        }
    } else {
        let file = std::fs::File::open(source).with_context(|| format!("reading {source}"))?;
        file.take(MAX_AVATAR_BYTES as u64 + 1).read_to_end(&mut image)?;
        if image.len() > MAX_AVATAR_BYTES {
            return Err(too_large());
        }
    }
    Ok(image)
}

/// Opens the TUI at once; it signs in and picks the team behind a loading
/// state. Only a missing session waits, for the browser sign-in.
async fn tui(start: app::Start, team: Option<String>) -> Result<i32> {
    let api_url = config::api_url();
    let token = match config::read_session().token {
        Some(token) => token,
        None => login::login(&api_url, false).await?.token.unwrap_or_default(),
    };
    let app = app::App::new(Api::new(api_url, token), config::read_prefs());
    if let Some((team_id, session_id)) = app.run(start, team).await? {
        let web = std::env::var("NUPHOS_WEB_URL").unwrap_or_else(|_| "https://nuphos.ai".into());
        let path = render::clean(&format!("/teams/{team_id}/agent/{session_id}"));
        println!("Conversation: {}{path}", web.trim_end_matches('/'));
        println!("Continue with: nuphos resume {}", render::clean(&session_id));
    }
    Ok(0)
}

/// The desktop's session, checked with `/auth/me`, with me and my teams
/// fetched together since every command needs both. The TUI signs in through
/// the browser when there is none; commands fail instead, since nobody may be
/// there to finish a browser sign-in.
async fn sign_in(interactive: bool) -> Result<(Api, Value, Vec<Value>)> {
    let api_url = config::api_url();
    let session = config::read_session();
    if let Some(token) = session.token.clone() {
        let api = Api::new(api_url.clone(), token);
        match tokio::try_join!(api.me(), api.teams()) {
            Ok((me, teams)) => return Ok((api, me, teams)),
            // Expired or signed out elsewhere.
            Err(e) if e.is_rejected_token() => config::forget_rejected(&session)?,
            Err(e) => return Err(e.into()),
        }
    }
    if !interactive {
        bail!("not signed in; run `nuphos login` (it can use Nuphos Desktop's sign-in)");
    }
    let session = login::login(&api_url, false).await?;
    let api = Api::new(api_url, session.token.unwrap_or_default());
    let (me, teams) = tokio::try_join!(api.me(), api.teams())?;
    Ok((api, me, teams))
}

#[cfg(test)]
mod avatar_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A chunked response that never ends must stop at the limit, not buffer forever.
    #[tokio::test]
    async fn an_endless_chunked_image_stops_at_the_limit() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/a.png", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let _ = socket.read(&mut request).await;
            let _ = socket.write_all(b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n").await;
            let chunk = format!("{:x}\r\n{}\r\n", 64 * 1024, "x".repeat(64 * 1024));
            while socket.write_all(chunk.as_bytes()).await.is_ok() {}
        });
        let error = read_avatar(&url).await.unwrap_err();
        assert!(error.to_string().contains("over 2 MB"), "{error}");
    }

    #[tokio::test]
    async fn a_file_over_the_limit_is_refused() {
        let path = std::env::temp_dir().join(format!("nuphos-avatar-{}.png", std::process::id()));
        std::fs::write(&path, vec![0u8; MAX_AVATAR_BYTES + 1]).unwrap();
        let result = read_avatar(path.to_str().unwrap()).await;
        std::fs::remove_file(&path).unwrap();
        assert!(result.unwrap_err().to_string().contains("over 2 MB"));
        let small = std::env::temp_dir().join(format!("nuphos-avatar-ok-{}.png", std::process::id()));
        std::fs::write(&small, b"png").unwrap();
        assert_eq!(read_avatar(small.to_str().unwrap()).await.unwrap(), b"png");
        std::fs::remove_file(&small).unwrap();
    }
}
