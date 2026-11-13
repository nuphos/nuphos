---
name: triggers
description: Manage Nuphos cron and webhook triggers through the canonical team REST API. Use for recurring agent work, webhooks from monitoring providers or other senders, listing/updating/removing triggers, or testing delivery.
---

# Nuphos Triggers API

Every trigger belongs to one existing conversation (`targetSessionId`), and
each cron or webhook fire is delivered into it. There is no team-wide trigger
list: whoever can read that conversation can see its triggers, and only the
conversation's owner can change them. Triggers are not one-shot
reminders. Use the canonical API through the bundled script; do
not call `trigger_*` bound tools.

```bash
SCRIPT=skills/triggers/scripts/trigger-api.sh
bash "$SCRIPT" "$TEAM" GET "?targetSessionId=$NUPHOS_SESSION_ID"
bash "$SCRIPT" "$TEAM" POST '' @/tmp/trigger.json
bash "$SCRIPT" "$TEAM" PATCH "$TRIGGER" @/tmp/trigger-patch.json
bash "$SCRIPT" "$TEAM" POST "$TRIGGER/test-fire" @/tmp/test-payload.json
```

The script authenticates with the conversation token, formats JSON, and fails
on non-2xx responses. Put request bodies in files.

## Routes

All paths start with `/teams/{teamId}/agent-triggers`.

| Action | Method and suffix |
|---|---|
| List a conversation's triggers | `GET /?targetSessionId={sessionId}` |
| List your own triggers | `GET /` |
| Create | `POST /` |
| Read | `GET /{triggerId}` |
| Update | `PATCH /{triggerId}` |
| Delete | `DELETE /{triggerId}` |
| Test once | `POST /{triggerId}/test-fire` with optional `{ "payload": {...} }` |

Create body:

```json
{
  "name": "Weekday PR digest",
  "triggerType": "cron",
  "cronExpression": "0 9 * * 1-5",
  "messageTemplate": "Review open PRs and summarize blockers.",
  "targetSessionId": "<sessionId>"
}
```

For a webhook trigger, `triggerType` is `webhook`. Optional fields are
`expiresAt`, `dedupeKey`, and `minIntervalSeconds`. The create response returns
the only copy of `webhookSecret`, the external `webhookUrl`, and
`secretHeader`. Never print or persist the secret in a skill, log, or final
answer.

`targetSessionId` is required on every create. It names the Task the trigger
belongs to, for good:

- The Task must be in the same team and owned by you. The trigger runs as the
  Task's owner, and only that owner can change or delete it.
- If the Task is mid-turn, the fire queues and runs when that turn ends.
  A fire into an archived Task restores it.
- The session id is the last segment of its `/agent/<sessionId>` link; for the
  current conversation use `$NUPHOS_SESSION_ID`.
- A trigger cannot be unbound. To report to Slack, say the exact destination
  in `messageTemplate`; the bound conversation posts with `slack_post`.

A trigger cannot move to another Task: create a new one there and delete the
old one.

## Webhook senders

A webhook trigger is a plain URL plus secret. Whatever calls it (a Grafana
contact point, an SNS subscription, a CI job) is configured and owned in that
provider; Nuphos does not track it, and deleting the trigger leaves it in
place. Point the sender at `webhookUrl` with the secret in the
`X-Webhook-Secret` header, or as `?secret=` on the URL when the sender cannot
set headers. AWS SNS subscriptions to that URL are confirmed automatically and
CloudWatch alarm notifications arrive normalized. For monitoring alerts, load
`monitoring-workflow` for wiring and rollback rules.

## Safety and lifecycle

- List your own triggers first and avoid near-duplicates. If similar recurring work exists,
  ask whether to update it or create a separate trigger.
- Cron expressions are always evaluated in UTC: convert the user's local time
  to UTC when writing one, confirm both the UTC and local time before creating,
  and restate `nextRuns` (UTC instants) in their timezone after creation.
- A conversation fired by a trigger must not create another trigger.
- Confirm before DELETE; prefer PATCH `{ "enabled": false }` when reversible.
  When removing a webhook trigger, also remove or detach its sender in the
  provider if the user wants that; Nuphos does not do it.
- `test-fire` only proves the message was queued for the bound conversation,
  not that the run completed successfully.
- Only the owner of the trigger's Task can update, delete or test-fire it.
  Creating one needs a team role above viewer.
