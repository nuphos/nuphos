---
name: resend
description: Send transactional email through a Resend account the user's team has bound to Nuphos — send a message, check what happened to one that was already sent, and (with a full-access key) inspect verified sending domains, audiences and contacts. Use whenever the user asks to email someone, mail a report/summary/alert, or check whether an email was delivered. Nuphos backend hands the agent a Resend API key; the agent calls api.resend.com directly with curl.
---

# resend

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants you to **send email on their behalf**, or to
check on mail already sent, through the **Resend account** their team has bound
to Nuphos. It closes the loop with the other skills: investigate a problem
(monitoring/cloud) → write up what you found → mail it to the people who need it.

## Sending is irreversible — read this first

Every other skill here reads, or changes something the user can undo. This one
puts a message in a stranger's inbox and there is no recall. Treat it that way:

- Send **only** the mail the user asked for, **only** to recipients they named.
  Never infer a recipient from context, a git log, an incident page, or a
  previous thread.
- **Never** send to test the setup. If you want to confirm the key works, list
  domains (`GET /domains`) — that costs nothing and mails no one.
- One request per message the user asked for. If a send appears to fail, do not
  blind-retry: check `GET /emails/{id}` first, because a network error after
  Resend accepted the mail means it already went out.
- Show the user the `from`, `to`, `subject` and body you intend to send and get
  their go-ahead **before** the first send of a conversation.
- Never print the API key into chat.

If the binding you need is not listed in this session's credentials, the user has
not enabled Resend for this conversation. Ask them to enable it — do not look for
another way to send.

## Setup

```bash
bash skills/resend/scripts/setup-credentials.sh <teamId> <integrationId>
source ~/.resend/nuphos.env
```

That writes `~/.resend/nuphos.env` (mode 600) with `RESEND_API_KEY`,
`RESEND_API_BASE_URL`, `RESEND_PERMISSION` and `RESEND_BINDING_ID`.

If setup fails with **HTTP 403**, this Resend binding is not enabled for this
conversation (or you are not on its allow-list). That is enforced server-side and
there is no way around it — unlike other providers, the key is never handed out
outside a session. Tell the user to enable the binding for this conversation
rather than looking for another route to the key. **HTTP 404** means the binding
was deleted.

Helper used throughout:

```bash
resend() {
  method="$1"; path="$2"; shift 2
  curl -sS -X "$method" \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    "${RESEND_API_BASE_URL}${path}" "$@"
}
```

## Key permission

`RESEND_PERMISSION` tells you what the key can do — it is probed at bind time:

- `sending_access` — `POST /emails` only. Every management call (`/domains`,
  `/audiences`, `/api-keys`) answers **401 `restricted_api_key`**. That is not a
  broken key and not a retryable error; the call is simply not available. Say so
  and move on.
- `full_access` — sending plus read/write on domains, audiences, contacts and
  api-keys.

Note Resend's status codes are back to front compared to most APIs: **401
`restricted_api_key`** means the key is fine but limited, while **403
`invalid_api_key`** is the one that means the key is actually bad.

## Send an email

`from` must be an address on a **verified** domain, otherwise Resend rejects the
send. With a full-access key, `GET /domains` shows which domains are verified.

```bash
resend POST /emails -d '{
  "from": "Nuphos <alerts@yourdomain.com>",
  "to": ["someone@example.com"],
  "subject": "Deploy failed on production",
  "text": "Plain-text body.",
  "html": "<p>HTML body.</p>"
}'
```

Required: `from`, `to` (string or array, max 50 recipients), `subject`. Supply at
least one of `text` / `html`. Optional: `cc`, `bcc`, `reply_to`, `headers`,
`attachments` (`filename` + `content` base64 or `path`), `tags`
(`{name, value}`), `scheduled_at` (ISO 8601 or natural language).

The response is just the id:

```json
{ "id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }
```

Report that id back to the user — it is how either of you checks on the mail
later.

## Check what happened to a message

```bash
resend GET /emails/49a3999c-0ce1-4ea6-ab68-afcd6dc2e794
```

Returns the message with `last_event` (e.g. `delivered`), `created_at`,
`scheduled_at`, the recipients and the body. Use this instead of re-sending when
you are unsure whether a send landed.

## Management calls (full-access keys only)

```bash
resend GET /domains                       # which domains can be sent from
resend GET /audiences                     # marketing audiences
resend GET /audiences/<audienceId>/contacts
```

Audiences and contacts are the **marketing** surface. Do not use them to
bulk-send: this skill is for transactional mail the user explicitly asked for,
and a broadcast to an audience is exactly the irreversible mass action the rules
above rule out.

## Errors worth recognising

| Status | name | What it means |
| --- | --- | --- |
| 401 | `restricted_api_key` | Valid key, sending-access only. Not retryable. |
| 403 | `invalid_api_key` | The key is bad or revoked. Ask the user to re-bind. |
| 422 | `validation_error` | Usually an unverified `from` domain, or no `text`/`html`. |
| 429 | `rate_limit_exceeded` | Back off; do not tight-loop. |
