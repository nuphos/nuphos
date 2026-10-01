---
name: monitoring-workflow
description: Build an end-to-end monitoring Watch from any provider to a Nuphos trigger and first-party Slack incident thread. Use for creating or wiring alerts, including providers without a dedicated Nuphos skill; discover their authenticated API or CLI dynamically instead of substituting provider-native Slack integrations.
---

# Generic monitoring workflow

Use this skill whenever the user asks to create, watch, or connect a monitoring
condition and notify or investigate through Nuphos. This is the workflow owner.
A provider-specific skill is optional supporting material, not a prerequisite.

The target architecture is always:

```text
provider-native condition
  -> provider webhook / notification destination
  -> Nuphos webhook trigger
  -> immediate first-party slack_post initial
  -> investigation
  -> investigation_result / material_update / resolved in the same thread
```

Load the `triggers` skill and use its `trigger-api.sh` wrapper for every Nuphos
Trigger or Watch Group operation below. Trigger bound tools are not available
in the native runtime; the canonical REST API is the source of truth.

Do not use Slack Incoming Webhooks, AWS Chatbot / Amazon Q Developer, or another
provider-native Slack integration unless the user explicitly asks for that
architecture. Slack delivery belongs to Nuphos.

## 1. Discover capabilities, do not enumerate vendors

1. Inspect the authenticated tools and CLIs available in this session.
2. If a provider skill exists, load it for exact commands and special protocol
   details.
3. If it does not exist, continue by inspecting:
   - CLI `help` and machine-readable command output;
   - an OpenAPI/API schema exposed by the provider;
   - official provider documentation;
   - the current live alert and notification configuration;
   - a provider-generated non-investigating test payload.
4. Determine whether the provider can:
   - create or read the requested alert condition;
   - add a webhook/notification destination without replacing existing ones;
   - send a stable event identity and distinguish firing from recovery;
   - authenticate delivery with `X-Webhook-Secret`, a `?secret=` query value,
     or a protocol Nuphos explicitly supports.

The absence of a named provider skill is not a blocker. Missing credentials,
API permissions, a usable webhook/polling surface, or an unsupported mandatory
signature protocol are real blockers.

## 2. Revalidate the request

- Existing alert/rule/policy: re-read the exact provider resource and bind only
  that resource.
- Dashboard widget or bare metric: it is not an alert condition. Propose the
  exact filter, reducer, comparison, threshold, duration, missing-data
  behavior, and incident closure behavior. Ask for approval and **STOP**.
  Create nothing until the user explicitly accepts that exact proposal.
- Preserve every pre-existing notification destination unless the user
  explicitly authorizes replacing one.

For Slack, call `slack_list_destinations` before creating the trigger:

- If connected, use the exact DM or channel the user selected.
- If it returns `slack_not_connected`, ask the user to connect the Nuphos Slack
  App and stop. Preserve the requested provider, condition, and destination in
  the explanation so the workflow can resume without redesign.
- Never interpret `slack_not_connected` as “Nuphos has no Slack API”.

## 3. Create the Nuphos receiver

For a user-approved Watch Group, first `GET /groups` to check for a
partially provisioned group, then `POST /groups` once with all
exact member keys, a self-contained group message template, and the single
approved destination. The tool returns one disabled ingress for each distinct
provider/integration partition — never create individual triggers for
members. For each ingress, prefer the provider's shared primitive:

- account/global event subscription with server-side member filtering;
- one notification-policy route/contact point matching the selected group;
- one notification channel/topic referenced by the selected policies; or
- a provider-native composite/group rule.

Use polling only when the provider cannot push. Configure the returned
provider-specific webhook URL, preserve existing destinations, and apply any
required per-member attachments using the returned bounded batches while
reusing that same sender. Read each batch back before continuing, drill the
full selected scope, then `POST /{triggerId}/finalize-wiring` with
`provider: "watch_group"`, the exact partition/member keys, selected strategy,
one `eventMatches` entry per member. Its values may contain only the member's
full stable provider resource ID and, when the provider payload emits it, that
ID's terminal path segment. Do not include statuses, names, labels, or any
other common payload scalar. Values must be unique across members. This
identity-only allow-list is the server-side filtering and incident-isolation
boundary. Include the secret-free typed receipts. Finalization enables only
that ingress. A partial failure stays visible and must never broaden the
provider route.

Create the trigger with `POST /teams/{teamId}/agent-triggers` using:

- `triggerType: "webhook"` when the provider can push;
- `monitoringIdentity.provider`: a stable lowercase key such as `grafana`,
  `aws`, `tencent-cloud`, or `acme-monitor`;
- `monitoringIdentity.integrationId`: the exact connected account, project, or
  integration identity used by the API/CLI;
- `monitoringIdentity.resourceId`: the exact alert/rule/policy identity;
- `incidentMode: true` and the exact approved `slackDestination`;
- a flood guard appropriate for the provider.

The message template must be self-contained and operate on the provider's real
payload:

1. A provider test/drill payload must STOP without investigating or posting.
2. A real firing calls `incident_history` first — has this alert gone off
   before, and in which thread?
3. Then post, quickly, from known payload facts, so whoever is watching knows
   it is being looked at. Pass `replyToThread` with a threadTs from the history
   when this is the same problem still going or coming back; omit it to start a
   new thread when it is genuinely different.
4. Then investigate, and follow up in that same thread when there is something
   worth saying. Judge that the way an on-call who respects their team would —
   nothing enforces it.
5. When it recovers, say so in its thread and stop. Nothing needs closing.
6. Use `bindConversation: true` so replies continue the same Nuphos incident.

Use explicit documented payload fields when available. If the schema is not
documented, require the provider's test delivery, inspect its exact payload,
and only then finish the template. Do not guess field names.

## 4. Wire the provider with its own API or CLI

Use the provider's authenticated API/CLI yourself:

1. Snapshot the current condition and notification destinations.
2. Create the narrowest Nuphos webhook/contact point/channel/topic.
3. Attach it additively to the exact condition.
4. Read back the condition and destination.
5. Verify unrelated destinations and condition semantics are unchanged.
6. Run the provider's cheapest non-investigating delivery test.
7. `POST /{triggerId}/test-fire` with a representative `test: true` payload to prove
   the Agent template's STOP branch.

If the provider can only be queried, use a cron trigger as an explicit polling
fallback. Polling must persist/compare state and notify only on transitions; it
must not post every poll.

## 5. Finalize ownership

Call the `finalize-wiring` API only after read-back and both applicable tests.

Use the provider-specific receipt when its schema is available. For any other
provider, use:

```json
{
  "provider": "generic",
  "providerKey": "tencent-cloud",
  "providerLabel": "Tencent Cloud Monitor",
  "integrationId": "stable account/project identity",
  "resourceId": "exact alert policy identity",
  "resources": [
    {
      "kind": "alert_policy",
      "name": "High CPU",
      "id": "exact provider resource id",
      "url": "https://provider.example/console/resource",
      "ownership": "created",
      "description": "What Nuphos created or changed for this Watch."
    }
  ],
  "manualCleanupInstructions": "Exact secret-free steps to detach the Nuphos destination and remove only Nuphos-created resources."
}
```

Generic receipts make dynamically created resources visible in Trigger details.
They do not pretend automatic provider cleanup exists: removal preserves those
external resources and shows the recorded manual cleanup instructions. Tell the
user about that limitation in the completion summary. Never store secrets,
tokens, credentials, executable commands, or raw untrusted payloads in a
receipt.

## 6. Atomicity

If any provider write, read-back, event mapping, or drill fails:

1. Disable/delete the new Nuphos trigger.
2. Use the same provider API/CLI to undo resources created in this attempt.
3. Restore modified routing from the snapshot.
4. Report the exact blocker.

Never call a workflow live merely because trigger creation returned a webhook
URL.
