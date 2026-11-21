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
  becomes `failed` and its owner gets one push notification from the backend. The record keeps
  `failureReason` and stays readable with `GET /agent/reminders/<id>`.
- Acknowledging an already delivered reminder changes nothing.

Reminders only run where the backend runs its sweeper, which does not need Redis.
