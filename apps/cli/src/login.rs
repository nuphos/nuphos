//! Browser sign-in, the desktop's native flow (RFC 8252 loopback + PKCE):
//! register a session, open the browser, take the `code` from the redirect to
//! 127.0.0.1, and redeem it for the token. Without a browser here, the user
//! pastes that redirect's address back instead.

use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::config::{self, Session};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REDEEM_INTERVAL: Duration = Duration::from_millis(1500);

fn random(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Signs in through the browser and saves the session where the desktop app
/// reads it.
pub async fn login(api_url: &str) -> Result<Session> {
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
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    // No browser here (a server over SSH): sign in from any browser and carry
    // the redirect back by hand. The code still reaches only that browser.
    let (mut browser, code) = if headless() {
        println!(
            "Open this link in a browser on any computer to sign in to Nuphos:\n\n  {start}\n\n\
             The browser then fails to load a 127.0.0.1 page. Copy that page's address\n\
             and paste it here (only into a terminal you started yourself):"
        );
        (None, pasted_code(&client_state, deadline).await?)
    } else {
        println!("Opening your browser to sign in to Nuphos…\nIf it does not open, visit:\n\n  {start}\n");
        let _ = open::that(start.as_str());
        let (stream, code) = loopback_code(&listener, &client_state, deadline).await?;
        (Some(stream), code)
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
            respond_to(&mut browser, 500, "Sign-in failed. Return to the terminal.").await;
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
        };
        config::write_session(&session)?;
        respond_to(&mut browser, 200, "Signed in to Nuphos. You can close this tab and return to the terminal.").await;
        return Ok(session);
    }
    bail!("Sign-in timed out")
}

/// SSH sessions, and Linux without a display, cannot open a browser here.
fn headless() -> bool {
    std::env::var_os("SSH_CONNECTION").is_some()
        || (cfg!(target_os = "linux")
            && std::env::var_os("DISPLAY").is_none()
            && std::env::var_os("WAYLAND_DISPLAY").is_none())
}

/// The `code` the browser was redirected with, or an error that ends the
/// sign-in; `None` when these parameters are not for this attempt.
fn callback_code(params: &[(String, String)], state: &str) -> Result<Option<String>> {
    if param(params, "state").as_deref() != Some(state) {
        return Ok(None);
    }
    if let Some(error) = param(params, "error") {
        bail!("Sign-in failed: {error}");
    }
    Ok(param(params, "code"))
}

async fn loopback_code(listener: &TcpListener, state: &str, deadline: Instant) -> Result<(TcpStream, String)> {
    loop {
        let (mut stream, _) = tokio::time::timeout_at(deadline.into(), listener.accept())
            .await
            .map_err(|_| anyhow!("Sign-in timed out"))??;
        let Some(params) = read_callback(&mut stream).await else {
            respond(&mut stream, 404, "Not found").await;
            continue;
        };
        let code = callback_code(&params, state);
        if let Ok(Some(code)) = code {
            return Ok((stream, code));
        }
        // The state ties the redirect to this attempt.
        let message = if param(&params, "state").as_deref() != Some(state) {
            "This sign-in link belongs to another attempt."
        } else {
            "Sign-in did not complete. Return to the terminal."
        };
        respond(&mut stream, 400, message).await;
        code?;
    }
}

/// Reads pasted addresses until one carries this attempt's code.
async fn pasted_code(state: &str, deadline: Instant) -> Result<String> {
    loop {
        let (read, line) = tokio::time::timeout_at(
            deadline.into(),
            tokio::task::spawn_blocking(|| {
                let mut line = String::new();
                std::io::stdin().read_line(&mut line).map(|n| (n, line))
            }),
        )
        .await
        .map_err(|_| anyhow!("Sign-in timed out"))???;
        if read == 0 {
            bail!("Sign-in canceled");
        }
        let params = url::Url::parse(line.trim())
            .map(|url| url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect::<Vec<_>>())
            .unwrap_or_default();
        match callback_code(&params, state)? {
            Some(code) => return Ok(code),
            None => println!("That is not the address this sign-in ended on; paste the whole 127.0.0.1 address:"),
        }
    }
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

async fn respond_to(browser: &mut Option<TcpStream>, status: u16, message: &str) {
    if let Some(stream) = browser {
        respond(stream, status, message).await;
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn query(url: &str) -> Vec<(String, String)> {
        url::Url::parse(url).unwrap().query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect()
    }

    #[test]
    fn callback_code_takes_only_this_attempt() {
        let ok = query("http://127.0.0.1:4242/callback?code=abc&state=s1");
        assert_eq!(callback_code(&ok, "s1").unwrap().as_deref(), Some("abc"));
        assert_eq!(callback_code(&ok, "s2").unwrap(), None);
        assert_eq!(callback_code(&query("http://127.0.0.1:1/callback?state=s1"), "s1").unwrap(), None);
        assert!(callback_code(&query("http://127.0.0.1:1/callback?state=s1&error=denied"), "s1").is_err());
        assert_eq!(callback_code(&[], "s1").unwrap(), None);
    }
}
