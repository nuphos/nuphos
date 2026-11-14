---
name: betterstack
description: Use Better Stack API credentials bound in Nuphos to inspect or manage Uptime monitors and Telemetry resources.
---

# Better Stack

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user asks to inspect or change Better Stack Uptime monitors, incidents, telemetry sources, collectors, metrics, or related settings through a Nuphos-bound Better Stack integration.

Authenticate before calling Better Stack APIs:

```bash
bash skills/betterstack/scripts/setup-credentials.sh <teamId> <integrationId>
```

The script calls the ordinary team API with the current `NUPHOS_TOKEN`:

- `/teams/:teamId/betterstack-integrations/:integrationId/credentials`

When the bearer is a conversation principal, the backend automatically enforces that the integration is selected for this conversation.

It writes `~/.betterstack/nuphos.env` containing:

- `BETTERSTACK_UPTIME_API_TOKEN` when the integration has an Uptime API token
- `BETTERSTACK_TELEMETRY_API_TOKEN` when the integration has a Telemetry API token

Source the env file in the same shell before using `curl`.

Useful endpoints:

- Uptime monitors: `https://uptime.betterstack.com/api/v2/monitors`
- Telemetry sources: `https://telemetry.betterstack.com/api/v1/sources`
- Telemetry collectors: `https://telemetry.betterstack.com/api/v1/collectors`
- Source metrics: `https://telemetry.betterstack.com/api/v2/sources/:source_id/metrics`

## Wiring a Better Stack incident to a Nuphos agent trigger

Use this when the user says "watch this monitor / when it goes down, do Y" (post to Slack, investigate…). The pattern: Better Stack keeps the condition (the monitor), Nuphos receives the incident notification (a webhook trigger), and the conversation the trigger is bound to performs Y. Every incident event lands in that same conversation.

**Completion contract:** creating the Nuphos trigger is only step 1. The Watch is not live until the Better Stack outgoing webhook is created with the narrowest scope the API supports, read back, and drill-tested. A generated Watch prompt explicitly authorizes additive wiring for the exact selected monitor, so do not ask for a second confirmation or hand UI setup steps to the user while the API can perform them.

If the requested destination is Slack, call `slack_list_destinations` before creating the trigger. Use only the user's explicit DM/channel choice and name its stable ID/DM in the messageTemplate. If the user chose Nuphos, do not add Slack delivery.

1. **Create the webhook trigger** through the `triggers` skill (`triggerType: "webhook"`, `targetSessionId` this conversation unless the user names another of theirs; first list the triggers bound to it and reuse one that already receives this monitor). Write the messageTemplate as the ACTION, branching on the incident payload — Better Stack posts incident events whose `data.attributes` include the incident `status`/`cause`/`started_at`/`resolved_at` and the monitored URL:

   ```text
   Better Stack incident event received.
   Target monitor: id <the exact selected monitor ID>; URL <the exact selected monitor URL>.
   Payload: {{payload.data}}
   FIRST compare payload.data.relationships.monitor.data.id and payload.data.attributes.url with that exact target. If the available identifier does not match, STOP immediately without investigating or notifying. Never infer a match from the incident name.
   If the payload contains "test": true or "drill": true, reply "test delivery received" and STOP — no investigation.
   For Slack, first check the earlier firings in this conversation to see whether this alert has already been reported. Investigate, then call slack_post once when this firing is worth telling people about — a new problem, a material change, or its recovery; an unchanged repeat needs no post. Post to the exact destination the user approved, as written in the messageTemplate, including slackWorkspaceId when it is known: {"type":"channel","channelId":"<the selected stable ID>","slackWorkspaceId":"<its workspace>"} for a channel, or {"type":"dm_self"} for a DM. Keep bindConversation on unless this conversation is already bound to a Slack thread, in which case pass bindConversation=false.
   For Nuphos-only delivery, keep the findings here and do not call slack_post.
   ```

   The exact target guard is mandatory even when provider-side scoping is available, and especially when the user explicitly accepts account-wide delivery as a fallback. Replace both placeholders with values read from the selected monitor; do not leave generic text in the stored template.

   Always include the drill line — delivery tests then cost one short reply instead of a full investigation session. Sanity check the create response: `webhookUrl` must be an absolute `https://` URL; if it is a bare path, STOP and tell the user the backend has no public base URL configured. NEVER substitute a different host for the returned webhookUrl (and never bypass sandbox checks to do so); if the URL looks temporary (e.g. *.trycloudflare.com) and the user has not already accepted temporary local-debug wiring, call `request_user_decision` with category `risk_tradeoff`, offer to use the temporary URL or wait for a permanent one, ask that single question, and STOP.

   Each Slack post is one message from this conversation; replies in the thread under the first, bound post continue this conversation. Tell the user they can reply there to continue with Nuphos.

   The result gives you `webhookUrl` and `webhookSecret` (returned only once).

2. **Create an outgoing webhook integration** pointing at the trigger. Keep the secret out of the URL and use Better Stack's custom header support:

   ```bash
   curl -sS -X POST 'https://uptime.betterstack.com/api/v2/outgoing-webhooks' \
     -H @<(printf 'Authorization: Bearer %s\n' "$BETTERSTACK_UPTIME_API_TOKEN") \
     -H 'content-type: application/json' \
     -d '{
       "name": "nuphos-<trigger name>",
       "url": "<webhookUrl>",
       "trigger_type": "incident_change",
       "custom_webhook_template_attributes": {
         "headers_template": [
           { "name": "Content-Type", "value": "application/json" },
           { "name": "X-Webhook-Secret", "value": "<webhookSecret>" }
         ]
       }
     }'
   ```

   If the documented v2 endpoint is unavailable to the connected token or plan, report that exact capability blocker rather than silently putting the secret in a query string.

3. **Scope it.** Inspect the current Better Stack API for a monitor/team/policy scope and use the narrowest server-side filter available. Never silently create an account-wide outgoing webhook for an exact-monitor Watch: filtering only in `messageTemplate` still starts an Agent session for every unrelated incident and violates the Watch scope. If the connected plan/API only supports account-wide delivery, that is a genuine capability blocker — roll back the trigger and ask whether the user accepts account-wide delivery before proceeding. If they explicitly accept it, the mandatory first template branch above must contain and compare the exact selected monitor ID/URL. As a backstop the trigger rate-limits webhook runs (server default 60s between runs; set `minIntervalSeconds` on the trigger for "at most every N minutes"). The limit applies to resolution deliveries too, so do not set it so long that a quick recovery is dropped.

4. **Verify before saying live**: read the outgoing webhook back and verify its exact URL, `X-Webhook-Secret` custom header configuration, and resource scope; never print the secret while doing so. Then `POST /{triggerId}/test-fire` (see the `triggers` skill) with a representative `{"test": true, ...}` payload to check the cheap action branch. Use Better Stack's non-mutating test facility when available. Pausing a real monitor to force an incident is a separate risky action and still requires explicit approval.

5. **Report what you created**: the outgoing-webhook ID, the selected monitor ID, and the verified scope (`monitor` or explicitly approved `account`). Nuphos does not record them, and removing the trigger leaves the outgoing webhook in Better Stack.

If webhook creation, scoping, read-back, or the drill fails, delete the newly created outgoing webhook and newly created trigger when safe. Report the exact blocker; do not leave an enabled half-configured workflow.

To tear down, confirm with the user, delete the outgoing webhook you created (read it back first to confirm it targets this trigger), then delete the trigger. Deleting the trigger alone does not touch Better Stack.

## Safety

- Do not print, echo, or paste Better Stack API tokens into chat.
- If the setup script returns 403, ask the user to enable the Better Stack integration in this session's credential selector.
- Use Uptime token only for Uptime APIs and Telemetry token only for Telemetry APIs.
