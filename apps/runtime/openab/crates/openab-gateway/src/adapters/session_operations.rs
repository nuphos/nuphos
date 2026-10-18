//! Gateway operations remain runtime truth until their response is released.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
#[derive(Default)]
struct Operation {
    pending: usize,
    configuring: usize,
    steering: usize,
    outcome: Option<Value>,
    cancelling: bool,
    generation: u64,
}
#[derive(Default)]
pub struct SessionOperations(Mutex<HashMap<String, Operation>>, tokio::sync::Notify);
pub struct PromptGuard {
    operations: Arc<SessionOperations>,
    channel: String,
    configuring: bool,
    steering: bool,
}
impl SessionOperations {
    pub fn channels(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .keys()
            .cloned()
            .collect()
    }

    pub fn prompt(self: &Arc<Self>, channel: String) -> PromptGuard {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(channel.clone())
            .or_default()
            .pending += 1;
        PromptGuard {
            operations: self.clone(),
            channel,
            configuring: false,
            steering: false,
        }
    }
    pub fn configuration(self: &Arc<Self>, channel: String) -> PromptGuard {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let operation = all.entry(channel.clone()).or_default();
        operation.pending += 1;
        operation.configuring += 1;
        PromptGuard {
            operations: self.clone(),
            channel,
            configuring: true,
            steering: false,
        }
    }
    pub fn steering(self: &Arc<Self>, channel: String) -> PromptGuard {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let operation = all.entry(channel.clone()).or_default();
        operation.pending += 1;
        operation.steering += 1;
        PromptGuard {
            operations: self.clone(),
            channel,
            configuring: false,
            steering: true,
        }
    }
    /// A prompt response cannot overtake the receipts of its native steering calls.
    pub async fn wait_for_steering(&self, channel: &str) {
        loop {
            let changed = self.1.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self
                .0
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(channel)
                .is_none_or(|op| op.steering == 0)
            {
                return;
            }
            changed.await;
        }
    }
    pub fn accepted(&self, channel: &str) {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let operation = all.entry(channel.into()).or_default();
        operation.outcome = None;
        operation.cancelling = false;
        operation.generation += 1;
    }
    pub fn start_cancellation(self: &Arc<Self>, channel: String) -> Option<(PromptGuard, u64)> {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let operation = all.entry(channel.clone()).or_default();
        if operation.cancelling {
            return None;
        }
        operation.cancelling = true;
        operation.pending += 1;
        Some((
            PromptGuard {
                operations: self.clone(),
                channel,
                configuring: false,
                steering: false,
            },
            operation.generation,
        ))
    }
    pub fn pending_count(&self, channel: &str) -> usize {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(channel)
            .map_or(0, |operation| operation.pending)
    }
    pub fn finish_cancellation(&self, channel: &str, generation: u64) {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(operation) = all
            .get_mut(channel)
            .filter(|op| op.generation == generation)
        {
            operation.cancelling = false;
            operation.outcome = Some(json!({"result":{"stopReason":"cancelled"}}));
        }
    }
    pub fn cancelling(&self, channel: &str, generation: u64) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(channel)
            .is_some_and(|operation| operation.cancelling && operation.generation == generation)
    }
    pub fn outcome(&self, channel: &str, outcome: Value) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(channel.into())
            .or_default()
            .outcome = Some(outcome);
    }
    pub fn pending(&self, channel: &str) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(channel)
            .is_some_and(|operation| operation.pending > 0)
    }
    pub fn snapshot(&self, channel: &str) -> Value {
        let all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        match all.get(channel) {
            Some(operation) => {
                json!({"promptPending":operation.pending > 0,"configuring":operation.configuring,"steering":operation.steering,"lastOutcome":operation.outcome,"cancelling":operation.cancelling})
            }
            None => {
                json!({"promptPending":false,"configuring":0,"steering":0,"lastOutcome":null,"cancelling":false})
            }
        }
    }
}
impl Drop for PromptGuard {
    fn drop(&mut self) {
        let mut all = self.operations.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(operation) = all.get_mut(&self.channel) {
            operation.pending -= 1;
            if self.steering {
                operation.steering -= 1;
                self.operations.1.notify_waiters();
            }
            if self.configuring {
                operation.configuring -= 1;
            }
            if operation.pending == 0 && operation.outcome.is_none() {
                all.remove(&self.channel);
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn steering_receipt_must_precede_prompt_release() {
        let operations = Arc::new(SessionOperations::default());
        let prompt = operations.prompt("s".into());
        let steer = operations.steering("s".into());
        let other = operations.steering("other".into());
        assert_eq!(operations.snapshot("s")["steering"], 1);
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            operations.wait_for_steering("s")
        )
        .await
        .is_err());
        drop(steer);
        operations.wait_for_steering("s").await;
        assert!(operations.pending("s"));
        drop(prompt);
        assert!(!operations.pending("s"));
        drop(other);
    }
    #[test]
    fn session_prompt_ownership_survives_an_overlapping_rejection() {
        let operations = Arc::new(SessionOperations::default());
        let first = operations.prompt("s".into());
        let overlapping = operations.prompt("s".into());
        drop(overlapping);
        assert!(operations.pending("s"));
        operations.outcome("s", json!({"stopReason":"cancelled"}));
        drop(first);
        assert!(!operations.pending("s"));
        assert_eq!(
            operations.snapshot("s")["lastOutcome"]["stopReason"],
            "cancelled"
        );
    }
}
