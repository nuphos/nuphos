---
name: triggers
description: Manage Nuphos cron and webhook triggers and Watch Groups through the canonical team REST API. Use for recurring agent work, webhook Watches, listing/updating/removing triggers, testing delivery, or finalizing provider wiring.
---

# Nuphos Triggers API

Triggers open a new agent conversation on every cron or webhook fire. They are
not one-shot reminders. Use the canonical API through the bundled script; do
not call `trigger_*` bound tools.

```bash
SCRIPT=skills/triggers/scripts/trigger-api.sh
bash "$SCRIPT" "$TEAM" GET
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
| List | `GET /` |
| Create | `POST /` |
| Read | `GET /{triggerId}` |
| Update | `PATCH /{triggerId}` |
| Delete | `DELETE /{triggerId}` |
| Test once | `POST /{triggerId}/test-fire` with optional `{ "payload": {...} }` |
| List Watch Groups | `GET /groups` |
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
  "messageTemplate": "Review open PRs and summarize blockers."
}
```

For a webhook Watch, `triggerType` is `webhook`. Optional fields are
`expiresAt`, `dedupeKey`, `monitoringIdentity`, `minIntervalSeconds`,
`incidentMode`, and `slackDestination`. The create response returns the only
copy of `webhookSecret`, the external `webhookUrl`, and `secretHeader`.
Never print or persist the secret in a skill, receipt, log, or final answer.

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

- Call GET first and avoid near-duplicates. If similar recurring work exists,
  ask whether to update it or create a separate trigger.
- Cron expressions are always evaluated in UTC: convert the user's local time
  to UTC when writing one, confirm both the UTC and local time before creating,
  and restate `nextRuns` (UTC instants) in their timezone after creation.
- A conversation fired by a trigger must not create another trigger.
- Confirm before DELETE; prefer PATCH `{ "enabled": false }` when reversible.
- `test-fire` only proves the run was started, not that the new conversation
  completed successfully.
- Team mutations require EDITOR/ADMINISTRATOR; deletion and execution-principal
  transfer have stricter server-side checks.
