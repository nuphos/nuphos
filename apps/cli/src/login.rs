//! Browser sign-in, the desktop's native flow (RFC 8252 loopback + PKCE):
//! register a session, open the browser, take the `code` from the redirect to
//! 127.0.0.1, and redeem it for the token.

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
