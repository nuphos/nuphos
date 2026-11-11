# Bot starters and coordination

Every Bot is an ordinary persistent agent. There is no primary/Chair identity,
selection API, exclusive coordination permission, star, or crown.

Desktop New Bot starts with discovery by default. An unchecked Help me coordinate
work option adds the coordination starter; there is no required role choice.
Both store standing instructions when the Bot is created. The discovery starter
asks about the purpose one question at a time; the coordination starter already
establishes delegation, follow-up, reporting, and validation as its working style.
For coordination onboarding, the model posts a short introduction and creates a
`request_user_decision` preference card with one scope question and 2–4 generated
choices. The existing card accepts a free-text answer too. Follow-up turns
acknowledge the answer in the original chat, save confirmed responsibilities
through `update_self`, and ask only the next necessary question. Onboarding is
not an approval flow and does not authorize work simply by showing options.
Confirmed responsibilities and preferences are saved through the existing
`update_self` tool. Templates never override team/personal policy or confer access.

After creating the private Bot chat, Desktop requests the one-time introduction.
The server validates the owner, team, active Bot and private single-Bot channel,
then atomically claims the pending introduction. Concurrent calls do not duplicate
it. A rejected handoff is retryable; a failed execution is surfaced in the chat.
Desktop keeps the Bot and channel IDs when retrying a failed setup, rather than
creating them again. The default and coordination starters both open a normal chat.
There is no public template sharing or publishing in this iteration.

## Coordination

The coordination starter supplies instructions for delegation and follow-up. It does not
change the Bot's runtime, credentials, permission mode, or access to other people's
conversations. Work is still executed by ordinary Tasks.

- `list_tasks` pages through directly nested Tasks with their recorded reports,
  open question counts, and links to the original conversations. An unreported
  Task has unknown status. Reports describe worker claims, not independent proof
  that work succeeded.
- `create_thread` accepts an optional `requestId`. Retrying the same parent-scoped
  key and prompt addresses the same Task and initial message. A changed prompt,
  archived Task, or changed parent is refused. Follow-ups use
  `send_message_to_thread`, rather than another delegation.
- `report_task` records a worker's useful result or blocker and notifies its
  current parent. `report_id` is immutable: a retry must use the same payload.
  Statuses are `working`, `waiting`, `ready`, `blocked`, `failed`, and `done`.
  Review pending means `ready`, not `done`.
- Originating channel IDs are retained when a Task is created from a channel
  turn and included in its report. They are context only; channel posting still
  requires the parent's existing membership and permissions.
- Human questions use `request_user_decision`. Desktop's existing Bot chat cards
  show questions from descendants and send the person's answer to the original
  Task. A report cannot grant approval or answer a question.

## Report delivery

`agent_task_reports` is a durable outbox. Reports are saved before adding a BullMQ
job; the trigger scheduler recovers reports that were not enqueued every minute.
Delivery rechecks membership, ownership, team, archive state, and the parent link.
The notification has a stable message ID and uses the existing conversation queue
and transcript deduplication. Five queue attempts use exponential backoff. Failed
jobs remain inspectable, and the report retains a delivery error; they do not
retry indefinitely. Redis and the trigger scheduler must be enabled for delivery.
Without Redis the report remains saved and the tool returns a delivery error.

These guarantees cover Task identity and notification delivery. They do not make
arbitrary external actions exactly-once: workers must verify external state and
use the destination's idempotency support before retrying a write.

A keyed Task whose preparation was interrupted is retained and reported as needing
inspection. It is not silently duplicated or automatically started before its
model and permission setup has finished.

## Scope

Coordination tools are available to ordinary team agents. Task reports concern
explicit child Tasks, not an automatic subscription to every Bot in the team.
Instructions cannot create durable background monitoring or grant extra access.
Mobile starter selection and public template sharing are not included.
The Desktop introduction requires a backend with the matching onboarding API.
