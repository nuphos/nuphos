//! The Nuphos REST calls this client makes, plus the `POST /agent/chat` event
//! stream. Responses stay `serde_json::Value`: the client reads a handful of
//! fields and sends the rest back untouched.

use std::io::Write;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;

const CLIENT: &str = concat!("nuphos-cli/", env!("CARGO_PKG_VERSION"));
/// The backend heartbeats every ~5 s; this much silence means a dead socket.
const IDLE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug)]
pub struct ApiError {
    pub status: u16,
    pub code: Option<String>,
    pub message: String,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ApiError {}

impl ApiError {
    fn network(e: reqwest::Error) -> Self {
        ApiError { status: 0, code: None, message: format!("Could not reach Nuphos: {e}") }
    }

    /// Reads an Atlas error body: `{ error: { code, message } }`.
    fn from_body(status: StatusCode, body: &str) -> Self {
        let parsed: Option<Value> = serde_json::from_str(body).ok();
        let error = parsed.as_ref().map(|v| v.get("error").unwrap_or(v));
        let code = error.and_then(|e| e["code"].as_str()).map(String::from);
        let message = error
            .and_then(|e| e["message"].as_str())
            .map(String::from)
            .unwrap_or_else(|| format!("Nuphos returned status {}.", status.as_u16()));
        ApiError { status: status.as_u16(), code, message }
    }

    /// For `/auth/me`: the server rejected the token, as opposed to a network
    /// failure that says nothing about it.
    pub fn is_rejected_token(&self) -> bool {
        self.status == 401 || self.status == 403
    }
}

#[derive(Clone)]
pub struct Api {
    base: String,
    token: String,
    http: reqwest::Client,
}

/// One event from a chat stream, tagged with the stream it belongs to so the
/// app can drop frames from a stream it has already replaced.
#[derive(Debug)]
pub enum StreamEvent {
    Frame(String, Value),
    /// The connection closed; `None` means cleanly.
    Ended(String, Option<String>),
}

impl Api {
    pub fn new(base: String, token: String) -> Self {
        Api { base, token, http: reqwest::Client::new() }
    }

    async fn call(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<&Value>,
    ) -> Result<Value, ApiError> {
        let mut request = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .query(query)
            .bearer_auth(&self.token)
            .header("accept", "application/json")
            .header("x-atlas-client", CLIENT)
            .timeout(Duration::from_secs(30));
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.map_err(ApiError::network)?;
        let status = response.status();
        let text = response.text().await.map_err(ApiError::network)?;
        if !status.is_success() {
            return Err(ApiError::from_body(status, &text));
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    pub async fn me(&self) -> Result<Value, ApiError> {
        self.call(Method::GET, "/auth/me", &[], None).await
    }

    pub async fn teams(&self) -> Result<Vec<Value>, ApiError> {
        let v = self.call(Method::GET, "/teams", &[], None).await?;
        Ok(v["teams"].as_array().cloned().unwrap_or_default())
    }

    /// `scope` is `mine`, or `shared`: others' conversations I take part in.
    pub async fn conversations(&self, team: &str, scope: &str) -> Result<Vec<Value>, ApiError> {
        let query =
            [("teamId", team), ("limit", "30"), ("scope", scope), ("sort", "activity"), ("archived", "exclude")];
        let v = self.call(Method::GET, "/agent/conversations", &query, None).await?;
        Ok(v["conversations"].as_array().cloned().unwrap_or_default())
    }

    /// The sidebar favorites, pinned conversations among them: `{ entries, revision }`.
    pub async fn favorites(&self, team: &str) -> Result<Value, ApiError> {
        self.call(Method::GET, &format!("/teams/{team}/favorites"), &[], None).await
    }

    pub async fn set_favorites(&self, team: &str, entries: &Value, revision: &Value) -> Result<Value, ApiError> {
        let body = json!({ "entries": entries, "expectedRevision": revision });
        self.call(Method::PUT, &format!("/teams/{team}/favorites"), &[], Some(&body)).await
    }

    pub async fn archive(&self, team: &str, session: &str) -> Result<Value, ApiError> {
        let body = json!({ "archived": true, "teamId": team });
        self.call(Method::PATCH, &format!("/agent/conversations/{session}/archive"), &[("teamId", team)], Some(&body))
            .await
    }

    pub async fn conversation(&self, team: &str, session: &str) -> Result<Value, ApiError> {
        let query = [("teamId", team), ("tail", "50")];
        self.call(Method::GET, &format!("/agent/conversations/{session}"), &query, None).await
    }

    pub async fn runtimes(&self, team: &str) -> Result<Vec<Value>, ApiError> {
        let v = self.call(Method::GET, &format!("/teams/{team}/agent-runtimes"), &[], None).await?;
        Ok(v["runtimes"].as_array().cloned().unwrap_or_default())
    }

    /// `{ models, controls }` — administrators only, unless the runtime is local.
    pub async fn runtime_models(&self, team: &str, runtime: &str, model: Option<&str>) -> Result<Value, ApiError> {
        let query: Vec<(&str, &str)> = model.map(|m| vec![("model", m)]).unwrap_or_default();
        self.call(Method::GET, &format!("/teams/{team}/agent-runtimes/{runtime}/models"), &query, None).await
    }

    /// Replaces the runtime's defaults — what a new conversation's first
    /// message starts with. For a Cloud agent this is the team's setting.
    pub async fn set_runtime_defaults(&self, team: &str, runtime: &str, defaults: &Value) -> Result<Value, ApiError> {
        let body = json!({ "defaults": defaults });
        self.call(Method::PATCH, &format!("/teams/{team}/agent-runtimes/{runtime}"), &[], Some(&body)).await
    }

    pub async fn model_config(&self, team: &str, session: &str) -> Result<Value, ApiError> {
        self.call(Method::GET, &format!("/agent/conversations/{session}/model-config"), &[("teamId", team)], None).await
    }

    pub async fn set_model_config(
        &self,
        team: &str,
        session: &str,
        config_id: &str,
        value: &str,
    ) -> Result<Value, ApiError> {
        let body = json!({ "configId": config_id, "value": value });
        self.call(
            Method::PATCH,
            &format!("/agent/conversations/{session}/model-config"),
            &[("teamId", team)],
            Some(&body),
        )
        .await
    }

    /// Moves a conversation to another runtime. `history` carries only the
    /// transcript; `workspace` also carries files and needs the same provider.
    pub async fn move_runtime(&self, team: &str, session: &str, runtime: &str, mode: &str) -> Result<Value, ApiError> {
        let body = json!({ "runtimeId": runtime, "mode": mode, "teamId": team });
        self.call(Method::POST, &format!("/agent/conversations/{session}/runtime"), &[("teamId", team)], Some(&body))
            .await
    }

    /// Stops the runtime's current turn; the stream closes with the runtime's
    /// own terminal frames.
    pub async fn cancel_runtime(&self, team: &str, session: &str) -> Result<Value, ApiError> {
        self.call(Method::POST, &format!("/agent/conversations/{session}/cancel-runtime"), &[("teamId", team)], None)
            .await
    }

    /// Opens `POST /agent/chat` and forwards every event to `tx` until the
    /// server closes the stream. A runtime that is still starting answers 409
    /// `runtime_not_accepting_message`; that is retried before giving up.
    pub async fn chat(&self, body: Value, tx: UnboundedSender<StreamEvent>) {
        let stream_id = body["streamId"].as_str().unwrap_or_default().to_string();
        let result = self.chat_inner(&stream_id, &body, &tx).await;
        let _ = tx.send(StreamEvent::Ended(stream_id, result.err()));
    }

    async fn chat_inner(&self, stream_id: &str, body: &Value, tx: &UnboundedSender<StreamEvent>) -> Result<(), String> {
        let team = body["teamId"].as_str().unwrap_or_default();
        let session = body["id"].as_str().unwrap_or_default();
        let mut attempt = 0;
        let response = loop {
            let response = self
                .http
                .post(format!("{}/agent/chat", self.base))
                .bearer_auth(&self.token)
                .header("accept", "text/event-stream")
                // A compressed event stream gets buffered.
                .header("accept-encoding", "identity")
                .header("x-atlas-client", CLIENT)
                .header("x-atlas-url", format!("/teams/{team}/agent/{session}"))
                .json(body)
                .send()
                .await
                .map_err(|e| ApiError::network(e).message)?;
            let status = response.status();
            if status.is_success() {
                break response;
            }
            let error = ApiError::from_body(status, &response.text().await.unwrap_or_default());
            if error.code.as_deref() == Some("runtime_not_accepting_message") && attempt < 30 {
                attempt += 1;
                let _ = tx.send(StreamEvent::Frame(
                    stream_id.to_string(),
                    json!({ "type": "phase", "phase": "Waiting for the agent to be ready" }),
                ));
                tokio::time::sleep(Duration::from_millis(500 * attempt.min(6))).await;
                continue;
            }
            return Err(error.message);
        };

        // `NUPHOS_DEBUG_FRAMES=<file>` appends every event, for debugging.
        let mut debug = std::env::var_os("NUPHOS_DEBUG_FRAMES").and_then(|path| {
            let mut options = std::fs::OpenOptions::new();
            options.create(true).append(true);
            // It holds whole conversations, like cli.yaml holds the token.
            #[cfg(unix)]
            std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
            options.open(path).ok()
        });
        let mut bytes = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut data = String::new();
        loop {
            let chunk = match tokio::time::timeout(IDLE_TIMEOUT, bytes.next()).await {
                Err(_) => return Err("The connection went quiet for too long.".into()),
                Ok(None) => break,
                Ok(Some(Err(e))) => return Err(format!("Lost the connection to Nuphos: {e}")),
                Ok(Some(Ok(chunk))) => chunk,
            };
            buffer.extend_from_slice(&chunk);
            while let Some(newline) = buffer.iter().position(|&b| b == b'\n') {
                let raw: Vec<u8> = buffer.drain(..=newline).collect();
                let line = String::from_utf8_lossy(&raw[..raw.len() - 1]);
                let line = line.strip_suffix('\r').unwrap_or(&line);
                if line.is_empty() {
                    // A blank line ends the event.
                    if !data.is_empty() && data != "[DONE]" {
                        if let Some(file) = debug.as_mut() {
                            let _ = writeln!(file, "{stream_id} {data}");
                        }
                        if let Ok(frame) = serde_json::from_str::<Value>(&data) {
                            let _ = tx.send(StreamEvent::Frame(stream_id.to_string(), frame));
                        }
                    }
                    data.clear();
                } else if let Some(value) = line.strip_prefix("data:") {
                    if !data.is_empty() {
                        data.push('\n');
                    }
                    data.push_str(value.strip_prefix(' ').unwrap_or(value));
                }
                // `: heartbeat` comments and other fields are ignored.
            }
        }
        Ok(())
    }
}
