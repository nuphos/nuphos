//! Browser sign-in, the desktop's native flow (RFC 8252 loopback + PKCE):
//! register a session, open the browser, take the `code` from the redirect to
//! 127.0.0.1, and redeem it for the token. Without a browser here, a code
//! approved on another device instead (RFC 8628).

use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::api::Api;
use crate::config::{self, Session};
use crate::render::clean;

const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REDEEM_INTERVAL: Duration = Duration::from_millis(1500);

fn random(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Signs in with the desktop app's session when it has one, else through the
/// browser, or with a code approved on another device when this one has no
/// browser (or `device` asks for it), and saves the CLI's own session.
pub async fn login(api_url: &str, device: bool) -> Result<Session> {
    if device || headless() {
        return device_code(api_url).await;
    }
    if let Some(session) = from_desktop(api_url).await {
        return Ok(session);
    }
    browser(api_url).await
}

/// Where no browser here could finish a sign-in: over SSH, or a Linux
/// session without a display.
fn headless() -> bool {
    let set = |key| std::env::var_os(key).is_some_and(|v| !v.is_empty());
    set("SSH_CONNECTION") || set("SSH_TTY") || (cfg!(target_os = "linux") && !set("DISPLAY") && !set("WAYLAND_DISPLAY"))
}

/// The machine's name, shown on the approval page so its approver can tell
/// which terminal is asking.
fn hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .or_else(|| std::process::Command::new("hostname").output().ok().and_then(|o| String::from_utf8(o.stdout).ok()))
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "Nuphos CLI".into())
}

/// Device sign-in (RFC 8628): show a code, wait while someone approves it on
/// nuphos.ai, as themselves or as an agent, then keep the token it yields.
async fn device_code(api_url: &str) -> Result<Session> {
    let http = reqwest::Client::new();
    let started: Value = http
        .post(format!("{api_url}/auth/device"))
        .json(&json!({ "clientName": hostname() }))
        .send()
        .await
        .context("Could not reach Nuphos")?
        .error_for_status()
        .context("This Nuphos server does not support sign-in with a code")?
        .json()
        .await?;
    let field =
        |key: &str| started[key].as_str().map(String::from).ok_or_else(|| anyhow!("Malformed sign-in response"));
    let (device_code, user_code, uri) = (field("deviceCode")?, field("userCode")?, field("verificationUri")?);
    let mut interval = Duration::from_secs(started["interval"].as_u64().unwrap_or(5));
    let deadline = Instant::now() + Duration::from_secs(started["expiresIn"].as_u64().unwrap_or(600));

    println!(
        "To sign in, open {} on any device and enter:\n\n    {}\n\nOnly enter it there yourself; never approve a code someone sent you.\nWaiting for approval…",
        clean(&uri),
        clean(&user_code)
    );
    while Instant::now() < deadline {
        tokio::time::sleep(interval).await;
        let response = http
            .post(format!("{api_url}/auth/device/token"))
            .json(&json!({ "deviceCode": device_code }))
            .timeout(Duration::from_secs(15))
            .send()
            .await;
        // A blip says nothing about the sign-in; keep trying.
        let Ok(response) = response else { continue };
        let status = response.status();
        let body: Value = response.json().await.unwrap_or_default();
        if status.is_success() {
            return save_device_session(&body);
        }
        match body["error"]["code"].as_str() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += Duration::from_secs(5),
            Some("access_denied") => bail!("The sign-in was denied."),
            Some("expired_token") => bail!("The code expired; run `nuphos login` again."),
            _ => bail!("Sign-in failed with status {status}"),
        }
    }
    bail!("The code expired; run `nuphos login` again.")
}

fn save_device_session(body: &Value) -> Result<Session> {
    let token = body["token"].as_str().ok_or_else(|| anyhow!("Malformed sign-in response"))?;
    let user = body["user"].clone();
    let session = Session {
        token: Some(token.to_string()),
        user: user["name"].as_str().map(String::from),
        username: user["username"].as_str().map(String::from),
        user_info: Some(user),
        keychain_account: None,
        from_env: false,
        cli_token: body.get("cliToken").cloned(),
    };
    config::write_session(&session)?;
    Ok(session)
}

/// `nuphos login --token`: a token minted on nuphos.ai, checked with
/// `/auth/me` before it is saved.
pub async fn with_token(api_url: &str, token: &str) -> Result<Session> {
    let me = Api::new(api_url.to_string(), token.to_string()).me().await.context("The token did not work")?;
    let session = Session {
        token: Some(token.to_string()),
        user: me["name"].as_str().map(String::from),
        username: me["username"].as_str().map(String::from),
        cli_token: me.get("cliToken").cloned(),
        user_info: Some(me),
        keychain_account: None,
        from_env: false,
    };
    config::write_session(&session)?;
    Ok(session)
}

/// The desktop app's session, copied once into the CLI's own: macOS asks once
/// whether the CLI may read the desktop's keychain item, and never again
/// after, since each then reads only its own. Checked with `/auth/me`, so a
/// stale desktop session falls back to the browser.
async fn from_desktop(api_url: &str) -> Option<Session> {
    // One read of the desktop's file decides both the backend and the token.
    let desktop = config::desktop_sign_in()?;
    // Its token belongs to the backend its account is on: never send it to another.
    if let Some(desktop_api) = desktop.api_url.as_deref().filter(|desktop| !config::same_backend(desktop, api_url)) {
        eprintln!("Nuphos Desktop is signed in on {}; continuing in the browser.", clean(desktop_api));
        return None;
    }
    eprintln!("Signing in as {} from Nuphos Desktop; macOS may ask once to allow it.", clean(&desktop.who));
    let Some(token) = desktop.token() else {
        eprintln!("Could not read the desktop sign-in; continuing in the browser.");
        return None;
    };
    let me = match Api::new(api_url.to_string(), token.clone()).me().await {
        Ok(me) => me,
        Err(e) => {
            eprintln!("The desktop sign-in did not work here ({e}); continuing in the browser.");
            return None;
        }
    };
    let session = Session {
        token: Some(token),
        user: me["name"].as_str().map(String::from),
        username: me["username"].as_str().map(String::from),
        user_info: Some(me),
        keychain_account: None,
        from_env: false,
        cli_token: None,
    };
    match config::write_session(&session) {
        Ok(()) => Some(session),
        Err(e) => {
            eprintln!("Could not save the sign-in ({e:#}); continuing in the browser.");
            None
        }
    }
}

/// Signs in through the browser.
async fn browser(api_url: &str) -> Result<Session> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let client_state = random(16);
    let code_verifier = random(48);
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));

    let http = reqwest::Client::new();
    let registered: Value = http
        .post(format!("{api_url}/auth/native/session"))
        .json(&json!({
            "redirectUri": format!("http://127.0.0.1:{port}/callback"),
            "codeChallenge": code_challenge,
            "codeChallengeMethod": "S256",
            "clientState": client_state,
        }))
        .send()
        .await
        .context("Could not reach Nuphos")?
        .error_for_status()
        .context("This Nuphos server does not support terminal sign-in")?
        .json()
        .await?;
    let handle = registered["handle"].as_str().ok_or_else(|| anyhow!("Malformed sign-in response"))?;

    let mut start = url::Url::parse(&config::login_url())?.join("/api/google/start")?;
    start.query_pairs_mut().append_pair("handle", handle);
    println!("Opening your browser to sign in to Nuphos…\nIf it does not open, visit:\n\n  {start}\n");
    let _ = open::that(start.as_str());

    let deadline = Instant::now() + LOGIN_TIMEOUT;
    let (mut browser, code) = loop {
        let (mut stream, _) = tokio::time::timeout_at(deadline.into(), listener.accept())
            .await
            .map_err(|_| anyhow!("Sign-in timed out"))??;
        let Some(params) = read_callback(&mut stream).await else {
            respond(&mut stream, 404, "Not found").await;
            continue;
        };
        // The state ties the redirect to this attempt.
        if param(&params, "state").as_deref() != Some(client_state.as_str()) {
            respond(&mut stream, 400, "This sign-in link belongs to another attempt.").await;
            continue;
        }
        if let Some(error) = param(&params, "error") {
            respond(&mut stream, 400, "Sign-in did not complete. Return to the terminal.").await;
            bail!("Sign-in failed: {error}");
        }
        match param(&params, "code") {
            Some(code) => break (stream, code),
            None => respond(&mut stream, 400, "Sign-in did not complete. Return to the terminal.").await,
        }
    };

    // Held open until the session is in hand, so the tab never claims success early.
    while Instant::now() < deadline {
        let response = http
            .post(format!("{api_url}/auth/native/session/redeem"))
            .json(&json!({ "handle": handle, "codeVerifier": code_verifier, "code": code }))
            .timeout(Duration::from_secs(15))
            .send()
            .await;
        let response = match response {
            // A blip says nothing about the sign-in; keep trying.
            Err(_) => {
                tokio::time::sleep(REDEEM_INTERVAL).await;
                continue;
            }
            Ok(r) => r,
        };
        if response.status().as_u16() == 409 {
            tokio::time::sleep(REDEEM_INTERVAL).await;
            continue;
        }
        if !response.status().is_success() {
            respond(&mut browser, 500, "Sign-in failed. Return to the terminal.").await;
            bail!("Sign-in failed with status {}", response.status());
        }
        let body: Value = response.json().await?;
        let token = body["token"].as_str().ok_or_else(|| anyhow!("Malformed sign-in response"))?;
        let user = body["user"].clone();
        let session = Session {
            token: Some(token.to_string()),
            user: user["name"].as_str().map(String::from),
            username: user["username"].as_str().map(String::from),
            user_info: Some(user),
            keychain_account: None,
            from_env: false,
            cli_token: None,
        };
        config::write_session(&session)?;
        respond(&mut browser, 200, "Signed in to Nuphos. You can close this tab and return to the terminal.").await;
        return Ok(session);
    }
    bail!("Sign-in timed out")
}

/// The query of a `GET /callback?…` request, or `None` for anything else.
async fn read_callback(stream: &mut TcpStream) -> Option<Vec<(String, String)>> {
    let mut buffer = vec![0u8; 8192];
    let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buffer)).await.ok()?.ok()?;
    let request = String::from_utf8_lossy(&buffer[..n]);
    let target = request.lines().next()?.strip_prefix("GET ")?.split(' ').next()?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != "/callback" {
        return None;
    }
    Some(url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect())
}

fn param(params: &[(String, String)], key: &str) -> Option<String> {
    params.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

async fn respond(stream: &mut TcpStream, status: u16, message: &str) {
    let body = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Nuphos</title></head>\
         <body style=\"font-family:system-ui;padding:3rem\"><p>{message}</p></body></html>"
    );
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}
