# One-time reminders

A reminder saves a message into one of your conversations at a time you choose, once. It needs no
Bot turn and no model, so it still arrives when the Bot's runtime is down or its model quota is
used up. Use a [Trigger](../apps/backend/src/lib/agent/trigger-service.ts) when a Bot should do
work on a schedule; use a reminder when you only need to be told.

## Create, list, cancel

```sh
# A local time read in a zone ...
curl -X POST "$API/agent/reminders" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<conversation>","text":"Send the invoice","dueAt":"2026-11-21T09:00","timeZone":"Europe/Stockholm"}'

# ... or an instant with Z or an offset.
#   "dueAt": "2026-11-21T08:00:00Z"

curl "$API/agent/reminders?status=pending" -H "Authorization: Bearer $TOKEN"
curl -X DELETE "$API/agent/reminders/<id>" -H "Authorization: Bearer $TOKEN"
```

A local time with no `timeZone` is rejected rather than guessed, and so is a time in the past.
`dedupeKey` makes a retried create return the reminder it already made. A conversation Bot reaches
the same routes under `/teams/<teamId>/agent-reminders`, but only for its own conversation. A reminder
can be cancelled only until a delivery attempt has claimed it.

## What delivered means

Each reminder has one stable ID, and the message it writes derives its ID from it. The reminder
becomes `delivered` only after that message is saved in the conversation, after the conversation and
your team membership were checked again. Starting a delivery attempt is not delivery. Reading the
message is not required.

- The backend sweeps every 30 seconds and claims due reminders under a two-minute lease. A reminder
  that came due while the backend was down is delivered by the first sweep after it starts.
- A failed attempt is retried up to five times, with growing delays. Writing the same message again
  is safe, so a crash between saving and acknowledging leaves one visible reminder.
- If the conversation is gone, archived or no longer yours, or the attempts run out, the reminder
  becomes `failed`. The backend then writes a notice into the conversation under a stable ID, so
  the owner finds exactly one the next time they open it, with push off or the device offline, and
  sends one push. The notice comes from the record, not from the moment of failure, so a crash in
  between only delays it. A conversation that is gone cannot hold one: the push and the readable
  `failed` record (`failureReason`) remain.
- Acknowledging an already delivered reminder changes nothing.

Reminders only run where the backend runs its sweeper, which does not need Redis.

## Scheduled work a Bot must confirm

`"kind": "task"` hands the text to the conversation as a normal turn at the due time, for work that
needs the Bot to do something. Dispatching it is not completing it.

```sh
curl -X POST "$API/agent/reminders" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"sessionId":"<conversation>","kind":"task","text":"Rotate the key","dueAt":"2026-11-21T09:00","timeZone":"Europe/Stockholm"}'
```

- The turn carries the occurrence ID and the confirmation call. Once the work has actually
  succeeded the Bot sends `POST /teams/<teamId>/agent-reminders/<id>/ack` with `{"outcome":"done"}`,
  or `{"outcome":"failed","reason":"..."}` if it cannot. Only the conversation the task was given
  to may confirm it: the owner outside that conversation gets 403 and another conversation gets 404.
  Repeating the same outcome changes nothing, and a contradicting one is a 409.
- A task is dispatched once, under a stable message ID. If the model is out of quota, the runtime
  crashes or the Bot never confirms within 15 minutes, the task becomes `unconfirmed`. The work may
  have run, so it is never run again. Its owner gets one notice in the conversation saying so, and a
  late `done` still corrects it. `failed` and `unconfirmed` read back through `GET /agent/reminders/<id>`.
- A task is a turn like a Trigger fire, with the conversation's existing permissions. It grants no
  extra authority or approval.
