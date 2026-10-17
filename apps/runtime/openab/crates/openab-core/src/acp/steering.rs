//! Native steering uses the existing provider session without taking its prompt lock.
use super::protocol::{JsonRpcMessage, JsonRpcRequest};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::AsyncWriteExt,
    process::ChildStdin,
    sync::{oneshot, Mutex},
};

#[derive(Clone)]
pub(crate) struct SteeringHandle {
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub next_id: Arc<AtomicU64>,
    pub pending: Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcMessage>>>>,
    pub session_id: String,
}
impl SteeringHandle {
    pub async fn steer(&self, prompt: Value) -> Result<Value, (i32, String)> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = JsonRpcRequest::new(
            id,
            "_session/steering",
            Some(json!({
                "sessionId": self.session_id, "prompt": prompt,
                "_meta": {"steering": {"idleBehavior": "promptRequired"}}
            })),
        );
        let data = serde_json::to_vec(&request)
            .map_err(|_| (-32603, "Invalid steering request".into()))?;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        // Never cancel a partially written JSON-RPC line on shared provider stdin.
        let write_result: Result<(), (i32, String)> = async {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(&data)
                .await
                .map_err(|_| (-32603, "Runtime input closed".into()))?;
            stdin
                .write_all(b"\n")
                .await
                .map_err(|_| (-32603, "Runtime input closed".into()))?;
            stdin
                .flush()
                .await
                .map_err(|_| (-32603, "Runtime input closed".into()))?;
            Ok(())
        }
        .await;
        if let Err(error) = write_result {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        let result = tokio::time::timeout(Duration::from_secs(10), async {
            let response = rx
                .await
                .map_err(|_| (-32603, "Runtime response closed".into()))?;
            if let Some(error) = response.error {
                return Err((error.code as i32, error.message));
            }
            let result = response
                .result
                .ok_or_else(|| (-32603, "Missing steering acknowledgement".into()))?;
            match result["outcome"].as_str() {
                Some("injected" | "promptRequired") => Ok(result),
                _ => Err((-32603, "Invalid steering acknowledgement".into())),
            }
        })
        .await
        .unwrap_or_else(|_| {
            Err((
                -32001,
                "Steering acknowledgement timed out; delivery is unknown".into(),
            ))
        });
        self.pending.lock().await.remove(&id);
        result
    }
}
