---
name: triggers
description: Manage Nuphos cron and webhook triggers and Watch Groups through the canonical team REST API. Use for recurring agent work, webhook Watches, listing/updating/removing triggers, testing delivery, or finalizing provider wiring.
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
| List your own Watch Groups | `GET /groups` |
| Create Watch Group | `POST /groups` |
| Update Watch Group | `PATCH /groups/{groupId}` |
| Test Watch Group | `POST /groups/{groupId}/test-fire` |
| Finalize provider wiring | `POST /{triggerId}/finalize-wiring` with `{ "wiring": ... }` |

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

For a webhook Watch, `triggerType` is `webhook`. Optional fields are
`expiresAt`, `dedupeKey`, `monitoringIdentity`, and `minIntervalSeconds`. The
create response returns the only
copy of `webhookSecret`, the external `webhookUrl`, and `secretHeader`.
Never print or persist the secret in a skill, receipt, log, or final answer.

`targetSessionId` is required on every create, including `POST /groups`:

- The session must be in the same team and owned by the
  trigger's execution principal.
- If the session is mid-turn, the fire queues and runs when that turn ends.
  A fire into an archived session restores it; deleting it pauses the
  trigger.
- The session id is the last segment of its `/agent/<sessionId>` link; for the
  current conversation use `$NUPHOS_SESSION_ID`.
- A trigger cannot be unbound. To report to Slack, say the exact destination
  in `messageTemplate`; the bound conversation posts with `slack_post`.

Move a trigger to another conversation with `PATCH /{triggerId}` (or a Watch
Group with `PATCH /groups/{groupId}`):

```json
{ "targetSessionId": "<sessionId>" }
```

`monitoringIdentity` is:

```json
{
  "provider": "grafana",
  "integrationId": "stable connected integration id",
  "resourceId": "exact provider alert id"
}
```

Use it instead of `dedupeKey` for provider Watches. Preserve existing provider
destinations and complete the provider API read-back/test workflow before
calling `finalize-wiring`. Load `monitoring-workflow` for the full receipt and
rollback rules.

## Safety and lifecycle

- List your own triggers first and avoid near-duplicates. If similar recurring work exists,
  ask whether to update it or create a separate trigger.
- Cron expressions are always evaluated in UTC: convert the user's local time
  to UTC when writing one, confirm both the UTC and local time before creating,
  and restate `nextRuns` (UTC instants) in their timezone after creation.
- A conversation fired by a trigger must not create another trigger.
- Confirm before DELETE; prefer PATCH `{ "enabled": false }` when reversible.
- `test-fire` only proves the message was queued for the bound conversation,
  not that the run completed successfully.
- Only the owner of the trigger's conversation can update, delete, test-fire or
  finalize it. Creating one needs a team role above viewer.
