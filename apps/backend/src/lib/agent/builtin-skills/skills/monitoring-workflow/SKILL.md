---
name: monitoring-workflow
description: Wire a monitoring alert from any provider to a Nuphos webhook trigger bound to one conversation, with optional first-party Slack updates. Use for creating or wiring alerts, including providers without a dedicated Nuphos skill; discover their authenticated API or CLI dynamically instead of substituting provider-native Slack integrations.
---

# Generic monitoring workflow

Use this skill whenever the user asks to create, watch, or connect a monitoring
condition and notify or investigate through Nuphos. This is the workflow owner.
A provider-specific skill is optional supporting material, not a prerequisite.

The target architecture is always:

```text
provider-native condition
  -> provider webhook / notification destination
  -> Nuphos webhook trigger, bound to one existing conversation
  -> that conversation investigates every firing
  -> optional first-party slack_post updates
```

Every Trigger needs `targetSessionId`. Use the current conversation
(`$NUPHOS_SESSION_ID`) unless the user names another of theirs.

The provider-side sender is the provider's resource, not Nuphos's: Nuphos does
not record, verify, or clean it up. Deleting the trigger leaves it in place.

Load the `triggers` skill and use its `trigger-api.sh` wrapper for every Nuphos
Trigger operation below. Trigger bound tools are not available
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

If the user wants Slack updates, call `slack_list_destinations` before creating
the trigger:

- If connected, use the exact DM or channel the user selected and write it
  into the message template.
- If it returns `slack_not_connected`, ask the user to connect the Nuphos Slack
  App and stop. Preserve the requested provider, condition, and destination in
  the explanation so the workflow can resume without redesign.
- Never interpret `slack_not_connected` as “Nuphos has no Slack API”.

## 3. Create the Nuphos receiver

First `GET` the existing triggers bound to this conversation and reuse one that
already receives this alert instead of creating a duplicate. Otherwise create
the trigger with `POST /teams/{teamId}/agent-triggers` using:

- `triggerType: "webhook"` when the provider can push;
- `targetSessionId`: the conversation that handles every firing;
- a flood guard appropriate for the provider.

The message template is delivered into the bound conversation on every firing,
so it must make sense between earlier firings and operate on the provider's
real payload:

1. A provider test/drill payload must STOP without investigating or posting.
2. A real firing first checks the earlier firings in this conversation — has
   this alert gone off before, and was it already reported?
3. Then investigate.
4. If the user wants Slack updates, call `slack_post` once per firing that is
   worth telling people about — a new problem, a material change, or its
   recovery — to the exact approved destination. An unchanged repeat needs no
   post. Keep `bindConversation` on unless this conversation is already bound
   to a Slack thread, so replies there continue this conversation.
5. When it recovers, say so and stop. Nothing needs closing.

Use explicit documented payload fields when available. If the schema is not
documented, require the provider's test delivery, inspect its exact payload,
and only then finish the template. Do not guess field names.

## 4. Wire the provider with its own API or CLI

Use the provider's authenticated API/CLI yourself:

1. Snapshot the current condition and notification destinations.
2. Create the narrowest webhook/contact point/channel/topic pointing at the
   trigger's `webhookUrl`, passing the secret as `X-Webhook-Secret` or
   `?secret=` when the sender cannot set headers.
3. Attach it additively to the exact condition.
4. Read back the condition and destination.
5. Verify unrelated destinations and condition semantics are unchanged.
6. Run the provider's cheapest non-investigating delivery test.
7. `POST /{triggerId}/test-fire` with a representative `test: true` payload to prove
   the Agent template's STOP branch.

If the provider can only be queried, use a cron trigger as an explicit polling
fallback. Polling must persist/compare state and notify only on transitions; it
must not post every poll.

## 5. Atomicity

If any provider write, read-back, event mapping, or drill fails:

1. Disable/delete the new Nuphos trigger.
2. Use the same provider API/CLI to undo resources created in this attempt.
3. Restore modified routing from the snapshot.
4. Report the exact blocker.

Never call a workflow live merely because trigger creation returned a webhook
URL.

When the workflow is live, tell the user which provider resources you created
or changed, so they can find them later: removing the trigger does not remove
them.
