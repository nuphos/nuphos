//! Runtime-owned blocking requests and decisions. Backend replicas are RPC brokers only.
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Default)]
pub struct SessionRequests(
    Mutex<HashMap<String, HashMap<String, Value>>>,
    Mutex<HashSet<String>>,
);
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl SessionRequests {
    pub fn open(&self, session: &str) {
        let _records = self.0.lock().unwrap_or_else(|e| e.into_inner());
        self.1
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(session);
    }
    pub fn cancel_pending(&self, session: &str) {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        self.1
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session.into());
        if let Some(requests) = all.get_mut(session) {
            for record in requests.values_mut().filter(|r| r["decision"].is_null()) {
                record["decision"] = json!({"kind":record["wait"]["kind"],"resolvedAt":now_ms(),"payload":{"approved":false,"decision":"rejected","cancelled":true,"reason":"runtime_cancelled"}});
            }
        }
    }

    pub fn pending(&self, session: &str) -> Vec<Value> {
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let Some(requests) = all.get_mut(session) else {
            return vec![];
        };
        requests.retain(|_, r| r["expiresAt"].as_u64().unwrap_or(0) > now_ms());
        requests
            .values()
            .filter(|r| r["decision"].is_null())
            .map(|r| r["wait"].clone())
            .collect()
    }

    pub fn handle(&self, session: &str, params: &Value) -> Result<Value, String> {
        let operation = params["operation"].as_str().ok_or("Missing operation")?;
        let user = params["userId"]
            .as_str()
            .filter(|u| !u.is_empty() && u.len() <= 128)
            .ok_or("Invalid userId")?;
        let mut all = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if operation == "register"
            && self
                .1
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains(session)
        {
            return Err("Runtime request owner was cancelled".into());
        }
        all.retain(|_, requests| {
            requests.retain(|_, r| r["expiresAt"].as_u64().unwrap_or(0) > now_ms());
            !requests.is_empty()
        });
        if !all.contains_key(session) && operation != "register" {
            return match operation {
                "list" => Ok(json!({"waits":[]})),
                "read" => Ok(json!({"wait":null,"decision":null})),
                "resolve" => Ok(json!({"resolved":false})),
                "expire" => Ok(json!({"ok":true})),
                _ => Err("Unknown request operation".into()),
            };
        }
        if !all.contains_key(session) && all.len() >= 4096 {
            return Err("Runtime request capacity reached".into());
        }
        let requests = all.entry(session.into()).or_default();
        requests.retain(|_, r| r["expiresAt"].as_u64().unwrap_or(0) > now_ms());
        if operation == "list" {
            let waits: Vec<_> = requests
                .values()
                .filter(|r| r["wait"]["userId"] == user && r["decision"].is_null())
                .map(|r| r["wait"].clone())
                .collect();
            return Ok(json!({"waits":waits}));
        }
        let id = params["waitId"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .ok_or("Invalid waitId")?;
        match operation {
            "register" => {
                let wait = &params["wait"];
                if wait["userId"] != user
                    || wait["waitId"] != id
                    || !matches!(
                        wait["kind"].as_str(),
                        Some(
                            "plan"
                                | "permission-grant"
                                | "authorization-rule"
                                | "client-tool"
                                | "agent-permission"
                        )
                    )
                {
                    return Err("Invalid blocking request".into());
                }
                if let Some(existing) = requests.get(id) {
                    if ["userId", "sessionId", "kind", "ref"]
                        .iter()
                        .any(|key| existing["wait"][key] != wait[key])
                    {
                        return Err("Request identity conflict".into());
                    }
                    return Ok(json!({"wait":existing["wait"]}));
                }
                if requests.len() >= 256 {
                    return Err("Too many outstanding requests".into());
                }
                requests.insert(
                    id.into(),
                    json!({"wait":wait,"decision":null,"expiresAt":now_ms()+6*60*60*1000}),
                );
                Ok(json!({"wait":wait}))
            }
            "read" => {
                let record = requests.get(id).filter(|r| r["wait"]["userId"] == user);
                Ok(record
                    .map(|r| json!({"wait":r["wait"],"decision":r["decision"]}))
                    .unwrap_or_else(|| json!({"wait":null,"decision":null})))
            }
            "resolve" => {
                let Some(record) = requests
                    .get_mut(id)
                    .filter(|r| r["wait"]["userId"] == user && r["decision"].is_null())
                else {
                    return Ok(json!({"resolved":false}));
                };
                if !params["decision"].is_object()
                    || params["decision"].to_string().len() > 1_048_576
                {
                    return Err("Invalid decision".into());
                }
                let mut decision = params["decision"].clone();
                decision["kind"] = record["wait"]["kind"].clone();
                decision["resolvedAt"] = json!(now_ms());
                record["decision"] = decision;
                Ok(json!({"resolved":true}))
            }
            "expire" => {
                if requests
                    .get(id)
                    .is_some_and(|r| r["wait"]["userId"] == user)
                {
                    requests.remove(id);
                }
                Ok(json!({"ok":true}))
            }
            _ => Err("Unknown request operation".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_resolves_requests_and_registration_retries_keep_the_original_identity() {
        let store = SessionRequests::default();
        let first = json!({"operation":"register","userId":"u","waitId":"w","wait":{"userId":"u","waitId":"w","sessionId":"c","kind":"client-tool","createdAt":1}});
        store.handle("s", &first).unwrap();
        let mut retry = first.clone();
        retry["wait"]["createdAt"] = json!(2);
        assert_eq!(store.handle("s", &retry).unwrap()["wait"]["createdAt"], 1);
        store.cancel_pending("s");
        assert!(
            store.handle("s", &retry).is_err(),
            "late registration cannot reopen a cancelled wait"
        );
        assert!(store.pending("s").is_empty());
        assert_eq!(
            store
                .handle("s", &json!({"operation":"read","userId":"u","waitId":"w"}))
                .unwrap()["decision"]["payload"]["cancelled"],
            true
        );
        store
            .handle("missing", &json!({"operation":"list","userId":"u"}))
            .unwrap();
        assert_eq!(
            store.0.lock().unwrap().len(),
            1,
            "reads never create session state"
        );
    }
    #[test]
    fn request_is_shared_authoritative_and_first_decision_wins() {
        let store = SessionRequests::default();
        let wait = json!({"waitId":"w","userId":"u","sessionId":"c","kind":"plan"});
        let register = json!({"operation":"register","userId":"u","waitId":"w","wait":wait});
        store.handle("s", &register).unwrap();
        assert_eq!(store.pending("s"), vec![wait]);
        let resolve = json!({"operation":"resolve","userId":"u","waitId":"w","decision":{"payload":{"approved":true}}});
        assert_eq!(store.handle("s", &resolve).unwrap()["resolved"], true);
        assert_eq!(store.handle("s", &resolve).unwrap()["resolved"], false);
        assert!(store.pending("s").is_empty());
        let read = store
            .handle("s", &json!({"operation":"read","userId":"u","waitId":"w"}))
            .unwrap();
        assert_eq!(read["decision"]["kind"], "plan");
        assert!(store
            .handle(
                "other",
                &json!({"operation":"read","userId":"u","waitId":"w"})
            )
            .unwrap()["decision"]
            .is_null());
        assert!(store
            .handle(
                "s",
                &json!({"operation":"read","userId":"other","waitId":"w"})
            )
            .unwrap()["decision"]
            .is_null());
    }
}
