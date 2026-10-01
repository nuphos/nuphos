---
name: grafana
description: Inspect and operate Grafana instances bound to an Nuphos team. All HTTP calls go through Nuphos backend's authenticated proxy — no SA token handling, no CORS, no extra setup. Covers dashboards, folders, datasources, queries (`/api/ds/query`), alerting, and Loki/Prometheus log + metric pulls.
---

# Grafana

Use this skill when the user wants you to look at or change anything on a Grafana instance their team has bound to Nuphos — dashboards, panels, alerts, datasources, or to actually run a Loki / Prometheus query and read back metrics or logs.

There is **nothing to install**. You don't talk to Grafana directly — you call Nuphos backend, and Nuphos backend proxies the request to the bound Grafana with the team's service-account token injected. The agent never sees the SA token.

## Setup

The bound Grafana instances are already listed for you under **Grafana instances** in the
credential section of the system prompt. Each line carries the `instanceId`, `name`,
`grafanaUrl`, and a ready-to-use `proxyBase` with the team id already filled in. Pick the
instance the user means and reuse its `proxyBase` for every call — there is no setup script
to run and no token to fetch.

```bash
# Reuse the helper from the nuphos-api skill (loads it if needed):
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }

# Stash the instance id from the credential section for the rest of the session.
GI=<instanceId from the credential section>
```

If the credential section lists no Grafana instances, tell the user a team admin needs to bind one first (`POST /teams/$TEAM/grafana-instances`, admin-only) — you cannot bind it for them because that requires the SA token, which they hold.

### Fallback: discover instances yourself

Only if the credential section is missing or looks stale. `$TEAM` is exported in the runtime
environment.

```bash
ac /teams/$TEAM/grafana-instances | python3 -m json.tool
# → { "instances": [ { "id": "...", "name": "...", "grafanaUrl": "https://..." } ] }
```

## How the proxy works

Every Grafana HTTP API path you'd hit on the upstream maps 1:1 onto:

```
${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}/teams/$TEAM/grafana-instances/$GI/proxy/<grafana-path>
```

- All HTTP methods are forwarded (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
- The agent's `Authorization: Bearer $NUPHOS_TOKEN` is consumed by Nuphos backend; the proxy strips it and replaces it with the bound `Bearer <saToken>` before forwarding. **Don't** try to send a Grafana token yourself — it'll just be discarded.
- Cookies and `Set-Cookie` are stripped both ways. This is an API channel, not a browser session.
- Query strings, request bodies, and response bodies pass through unchanged. You can stream Loki `tail` responses if needed.
- 30 s upstream timeout. Long Prometheus range queries should narrow the time window or use `step=` rather than retrying.

So a Grafana docs example like `GET /api/dashboards/uid/abc123` becomes:

```bash
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/dashboards/uid/abc123" | python3 -m json.tool
```

## Common operations

```bash
# --- Sanity / identity ---
# Confirm the proxy works and the SA token is valid.
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/health" | python3 -m json.tool
# Identity of the bound service account (perms come from this SA's role).
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/user" | python3 -m json.tool

# --- Dashboards / folders ---
# Search (free-text). type=dash-db for dashboards, dash-folder for folders.
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/search?type=dash-db&query=api" \
  | python3 -m json.tool
# Full dashboard JSON by uid (use this to read panel queries before running them).
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/dashboards/uid/<uid>" \
  | python3 -m json.tool
# List folders.
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/folders" | python3 -m json.tool

# --- Datasources ---
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/datasources" | python3 -m json.tool
# By name (URL-encode if it has spaces).
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/datasources/name/prometheus" \
  | python3 -m json.tool

# --- Alerting (Grafana-managed alerts, not classic dashboard alerts) ---
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/v1/provisioning/alert-rules" \
  | python3 -m json.tool
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/alertmanager/grafana/api/v2/alerts" \
  | python3 -m json.tool
```

## Running queries (the actually-useful part)

To pull metric or log data, prefer the unified `POST /api/ds/query` endpoint — it works for any datasource Grafana knows about and accepts the same payload Grafana's frontend sends. You'll need the datasource's `uid` (from `GET /api/datasources` above) and its `type`.

```bash
# 1. Get the datasource uid + type.
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/datasources" \
  | python3 -c '
import json, sys
for d in json.load(sys.stdin):
    print(d["uid"], d["type"], d["name"])'

# 2. Prometheus instant query (last value of a metric).
DS_UID=<prometheus uid from step 1>
ac -X POST "/teams/$TEAM/grafana-instances/$GI/proxy/api/ds/query" \
  -H 'content-type: application/json' \
  -d "{
    \"queries\": [{
      \"refId\": \"A\",
      \"datasource\": { \"uid\": \"$DS_UID\", \"type\": \"prometheus\" },
      \"expr\": \"sum(rate(http_requests_total[5m]))\",
      \"instant\": true
    }],
    \"from\": \"now-5m\",
    \"to\": \"now\"
  }" | python3 -m json.tool

# 3. Prometheus range query (time series).
ac -X POST "/teams/$TEAM/grafana-instances/$GI/proxy/api/ds/query" \
  -H 'content-type: application/json' \
  -d "{
    \"queries\": [{
      \"refId\": \"A\",
      \"datasource\": { \"uid\": \"$DS_UID\", \"type\": \"prometheus\" },
      \"expr\": \"sum(rate(http_requests_total[5m])) by (status)\",
      \"range\": true,
      \"intervalMs\": 30000,
      \"maxDataPoints\": 200
    }],
    \"from\": \"now-1h\",
    \"to\": \"now\"
  }" | python3 -m json.tool

# 4. Loki log query.
LOKI_UID=<loki uid>
ac -X POST "/teams/$TEAM/grafana-instances/$GI/proxy/api/ds/query" \
  -H 'content-type: application/json' \
  -d "{
    \"queries\": [{
      \"refId\": \"A\",
      \"datasource\": { \"uid\": \"$LOKI_UID\", \"type\": \"loki\" },
      \"expr\": \"{namespace=\\\"prod\\\"} |= \\\"error\\\"\",
      \"queryType\": \"range\",
      \"maxLines\": 100
    }],
    \"from\": \"now-30m\",
    \"to\": \"now\"
  }" | python3 -m json.tool
```

If the user already has a panel in mind, fetch the dashboard JSON (`/api/dashboards/uid/<uid>`), pull the panel's `targets[]` (each is a query), and reuse them in `/api/ds/query` — that way the data you show matches what they see in the UI exactly.

For Prometheus-only flows you can also hit the datasource-native endpoints, which return raw Prometheus shapes:

```bash
ac "/teams/$TEAM/grafana-instances/$GI/proxy/api/datasources/proxy/uid/$DS_UID/api/v1/query?query=up" \
  | python3 -m json.tool
```

## Wiring a Grafana alert to a Nuphos agent trigger

Use this when the user says "watch this alert / when X fires, do Y" (post to Slack, investigate, scale something…). The pattern: Grafana keeps the condition (the alert rule), Nuphos receives the notification (a webhook trigger), and an agent session performs Y. Slack incident delivery reuses the open incident conversation.

**Completion contract:** creating the Nuphos trigger is only step 1 and NEVER means the Watch is live. Finish the contact point, exact-rule routing, read-back, and drill in the same turn. A generated Watch prompt explicitly authorizes additive wiring scoped to that exact rule, so do not ask for a second confirmation. Preserve every existing notification receiver by default; only ask when the provider cannot preserve it without a genuine tradeoff. Never hand the user the webhook URL or Grafana setup instructions when this authenticated proxy can perform the writes.

If the requested destination is Slack, call `slack_list_destinations` before creating the trigger. The destination must come from the user's explicit Watch choice: `dm_self`, or one exact joined channel. Persist that exact choice in `trigger_create.slackDestination` as well as naming it in the messageTemplate; the structured field is the server-enforced authorization boundary. If the user chose Nuphos, keep the result in the fresh Nuphos conversation and do not add Slack delivery.

1. **Create the webhook trigger** with `trigger_create` (`triggerType: "webhook"`; set `monitoringIdentity` to `{provider:"grafana", integrationId:"<connected Grafana integration ID>", resourceId:"<exact alert-rule UID>"}` so retries reuse one trigger; when Slack is the action, also set `incidentMode: true` and `slackDestination` to the exact approved DM/channel). Write the messageTemplate as the ACTION, branching on the Grafana payload — a webhook notification body has `status` ("firing" | "resolved"), `title`, `message`, and `alerts[]` with `labels`/`annotations`:

   ```text
   Grafana alert notification received (status: {{payload.status}}).
   Title: {{payload.title}}
   If the payload contains "test": true or "drill": true, or clearly identifies Grafana's contact-point test notification, reply "test delivery received" and STOP — no investigation.
   For Slack, handle it the way an on-call engineer would. Call incident_history first to see whether this alert has gone off before and in which thread, and slack_read_channel if you want to know what is already in the channel. Post something quickly so whoever is watching knows it is being looked at, then investigate and follow up in the same thread when you know more.
   Pass replyToThread with a threadTs from incident_history when this firing is the same problem still going or coming back; omit it to start a new thread when it is genuinely different. There is no message type to declare. When it has recovered, say so in its thread and stop — nothing needs to be closed. Pass the exact destination object stored on the trigger, including slackWorkspaceId when it is present — reconstructing it as only {"type":"channel","channelId":"..."} can be refused or aimed at the wrong workspace. For a new Watch, persist that same exact object in trigger_create.slackDestination: {"type":"channel","channelId":"<the selected stable ID>","slackWorkspaceId":"<its workspace>"} for a channel, or {"type":"dm_self"} for a DM.
   For Nuphos-only delivery, keep the findings here and do not call slack_post.
   ```

   Always include the drill line: delivery tests then cost one short reply instead of a full investigation session — send `{"test": true, "status": "firing"}` when verifying.

   A Slack firing notification uses one root message for one incident conversation, followed by one investigation-result reply. Later meaningful changes and recovery also stay in that thread. Mention in the root that the user can reply there to continue with Nuphos.

   The result gives you `webhookUrl` and `webhookSecret` (returned only once).

2. **Create a contact point** pointing at the trigger. Sanity check first: the `webhookUrl` from trigger_create must be an absolute `https://` URL — if it is a bare path, the backend has no public base URL configured; STOP and tell the user instead of guessing a host. NEVER substitute a different host for the returned webhookUrl (and never bypass sandbox checks to do so); if the URL looks temporary (e.g. *.trycloudflare.com) and the user has not already accepted temporary local-debug wiring, call `request_user_decision` with category `risk_tradeoff`, offer to use the temporary URL or wait for a permanent one, ask that single question, and STOP. Prefer the `headers` field (supported since Grafana 11) carrying `X-Webhook-Secret`; on older Grafana fall back to `?secret=` in the URL (our receiver accepts both). Do NOT use `authorization_scheme`/Bearer — the receiver doesn't read Authorization:

   ```bash
   ac -X POST "/teams/$TEAM/grafana-instances/$GI/proxy/api/v1/provisioning/contact-points" \
     -H 'content-type: application/json' \
     -d "{
       \"name\": \"nuphos-<trigger name>\",
       \"type\": \"webhook\",
       \"settings\": {
         \"url\": \"<webhookUrl>\",
         \"httpMethod\": \"POST\",
         \"headers\": { \"X-Webhook-Secret\": \"<webhookSecret>\" }
       }
     }"
   # Older Grafana (headers field rejected): settings.url = "<webhookUrl>?secret=<webhookSecret>" instead.
   ```

3. **Route only the selected rule, additively.** First fetch the full alert rule and the WHOLE notification-policy tree. Determine every receiver that currently handles this rule: its direct `notification_settings.receiver`, or the effective policy route(s), including `continue` siblings. If you cannot determine the existing receiver set safely, stop with that exact ambiguity instead of guessing.

   Grafana rules that directly select a contact point use an internal policy and do **not** pass through the user policy tree. Therefore adding a normal child policy while leaving `notification_settings.receiver` set does nothing. The safe Watch recipe is:

   1. Save the full rule and full policy tree for rollback, including response `ETag`, `resourceVersion`, `version`, `updated`, or equivalent concurrency metadata when present. Immediately before each full-resource PUT, GET that resource again and compare its canonical JSON with the snapshot you based the edit on. If it changed, abort and recompute instead of overwriting someone else's edit. When the Grafana endpoint/version exposes optimistic concurrency (`resourceVersion`, a version parameter, or `ETag`/`If-Match`), send it on the write. The legacy `/api/v1/provisioning/alert-rules/:uid` and `/policies` endpoints do not expose a general version parameter, so the immediate preflight comparison is mandatory there. Apply the same guard to rollback: restore a snapshot only when the current resource still equals the state written by this attempt; otherwise stop and report the concurrent edit.
   2. Add a unique exact-match label to this rule, normally `nuphos_watch="<trigger id>"`. Fail closed if `nuphos_watch` already exists: reuse it only when its value, contact point, policy route, and trigger all match this same workflow. Never overwrite a different Watch's label. Otherwise choose a collision-free valid label key such as `nuphos_watch_<short trigger id>` (letters, digits, and underscores only), re-fetch the rule to prove that key is absent, and use that exact key/value in every matcher and read-back check. Use the trigger id, not only `alertname`, so duplicate rule names cannot broaden delivery.
   3. If the rule has direct `notification_settings`, preserve its receiver/timing values, then set `notification_settings` to `null` in the full rule body so this rule uses the policy tree. PUT the complete rule back; preserve every unrelated field.
   4. For a rule that was already policy-routed, prepend only an exact-label Nuphos route with `"continue": true`, then leave the original policy tree untouched so it continues to determine every prior delivery. Do not synthesize or reorder its receiver routes: route order, nested inheritance, `continue`, and mute intervals are semantic. Only when step 3 cleared a direct `notification_settings` receiver should you prepend an exact-label compatibility route for that direct receiver (copy its direct grouping/timing settings, `"continue": true`), followed by the exact-label Nuphos route with `"continue": false`; stopping there preserves the former direct receiver plus Nuphos without accidentally adding the policy tree's default receiver.
   5. Re-fetch and compare the policy snapshot (and send its concurrency token where supported), then PUT the WHOLE policy tree back — never a partial tree, because Grafana replaces the tree.

   Do not append the webhook integration to a shared receiver: that would send every alert using the receiver to Nuphos. If the user explicitly asks to replace existing notifications or enable Agent for a whole shared receiver, explain the blast radius and confirm that broader change separately.

4. **Control noise at every layer.** Grafana re-sends on `repeat_interval` while an alert stays firing. Set a long `repeat_interval` (e.g. `4h`) and a sensible `group_wait` so the trigger fires mostly on transitions; set `minIntervalSeconds` for retry bursts. For Slack, `incidentMode` reuses one open Nuphos conversation and enforces one root, material updates in its thread no more than once per 15 minutes / three per hour, and one resolution. The Agent still makes the semantic SRE judgment: repeated timestamps, minor metric movement, and unchanged evidence are not material and should not call `slack_post`.

5. **Verify end-to-end before saying live**:
   - GET the contact points and verify the new Nuphos receiver exists and targets this trigger.
   - GET the alert rule and verify its unique `nuphos_watch` label plus policy-routing state.
   - GET the policy tree and verify the exact-label Nuphos route exists, any compatibility route came only from cleared direct `notification_settings`, and the original policy tree is otherwise structurally unchanged.
   - Use `trigger_test_fire` with `{"test": true, "status": "firing", "title": "Nuphos wiring drill"}` to check the cheap action branch, then Grafana's contact-point test (`POST /api/v1/provisioning/contact-points/test` where supported) to prove Grafana contact point → trigger delivery.
   - A contact-point test does **not** prove that this alert rule selects the expected preserved receiver(s) plus Nuphos. If this Grafana version exposes a rule-level preview/drill that evaluates the exact saved rule through notification routing, run it and verify every expected receiver. Otherwise state precisely: "contact-point delivery verified; exact-rule routing structurally verified but runtime routing unverified". Do not describe the whole workflow as end-to-end tested or fully live until a real firing delivery or supported rule-level routing drill proves that last hop.

6. **Register deterministic cleanup.** After the read-back and drill succeed, call `trigger_finalize_wiring` with `provider: "grafana"`, the Grafana integration ID, alert-rule UID, contact-point UID/name, exact label key/value, and `routingMode`. Use `policy` when the rule was already policy-routed. Use `direct_converted` when step 3 cleared direct routing, and include the complete former `notification_settings` object as `previousNotificationSettings` so deletion can restore it. Only Grafana's reversible notification fields are accepted there: `receiver`, `group_by`, `group_wait`, `group_interval`, `repeat_interval`, `mute_time_intervals`, and `active_time_intervals`; omit fields Grafana did not return. This receipt must contain IDs/routing metadata only — never the webhook secret or SA token. The Watch is not complete until this call succeeds.

   Only then report the verified chain and its exact status: rule → old receiver(s) + Nuphos contact point → trigger → selected destination. Call it fully live only when the runtime-routing requirement above passed; otherwise keep the explicit structural/runtime caveat.

If any provider write or verification fails, restore the saved rule/policy snapshots, delete the newly created contact point, and delete the newly created trigger when safe. Report the exact failed API call; do not leave an enabled orphan trigger and call the workflow complete.

To tear down, confirm with the user and call `trigger_delete`; the backend uses the finalized receipt to restore/detach exact-rule routing, verify it, delete the contact point, then delete the local trigger. Do not separately mutate Grafana first.

## Safety

- **Read-only by default.** `GET` calls against `/api/search`, `/api/dashboards/uid/...`, `/api/datasources`, `/api/folders`, `/api/v1/provisioning/...`, and `POST /api/ds/query` are safe.
- **Confirm before mutating.** `POST /api/dashboards/db` (create / update dashboard), `DELETE /api/dashboards/uid/<uid>`, `POST/PUT/DELETE` on `/api/datasources`, `/api/folders`, `/api/alertmanager/...`, `/api/v1/provisioning/...` all change state. Summarize the exact change (which dashboard, which folder, which alert rule) and ask the user before sending the request. A generated Watch prompt already confirms the additive, exact-rule wiring described above; do not ask twice.
- **Treat dashboards like code.** When updating a dashboard, fetch the current JSON first, modify the relevant fields, bump `version`, and POST back the full payload — don't write a "best guess" dashboard from scratch unless the user explicitly asked for net-new.
- **Don't dump secrets.** `/api/datasources` responses include `secureJsonFields` (booleans, fine) but `basicAuthPassword` / `secureJsonData` should never be printed back to the user even if they appear; summarize "datasource X has basic auth configured" instead.
- **No raw SA token.** The proxy holds it; you can't read it and you don't need to. If a user asks "what's the token", tell them it's stored encrypted on Nuphos backend and only an admin can rotate it via `DELETE` + re-bind.
- **Errors from the proxy.** `404 grafana_instance_not_bound` means the `$GI` is wrong for this team. `502 grafana_unreachable` means the upstream Grafana is down or the URL is misconfigured — don't retry in a tight loop, tell the user. Anything else is the upstream Grafana's own status code, passed through verbatim.
