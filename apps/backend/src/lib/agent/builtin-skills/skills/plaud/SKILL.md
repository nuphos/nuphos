---
name: plaud
description: Read Plaud recordings — list and search recordings, read transcripts, AI summaries and highlights, and get a temporary audio URL — through a Plaud account the user's team has connected to Nuphos via OAuth. Use whenever the user asks about a meeting or call they recorded with Plaud (Plaud Note, NotePin), wants a summary, action items, a follow-up draft or quotes from a recording, or asks what was said in a conversation. Nuphos backend hands the agent a short-lived Plaud access token; the agent calls the Plaud API directly with curl.
---

# plaud

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Plaud recordings are private conversations. Read only the recordings the
request needs, quote sparingly, and never copy transcripts into places the user
did not ask for. The access is read-only.

## Setup

The session's credential context lists each enabled Plaud account with an exact
`setupCommand`. Run it once per conversation (and again on a 401):

```bash
bash skills/plaud/scripts/setup-credentials.sh <teamId> <bindingId> && source ~/.plaud/nuphos.env
```

It writes `PLAUD_ACCESS_TOKEN`, `PLAUD_API_BASE_URL` and `PLAUD_MCP_URL` to a
private env file. Never print the token. Every shell call is a fresh process, so
source the env file in each call that uses it.

If no Plaud account is listed, ask the user to enable one for this session, or
to have an administrator connect Plaud under Integrations.

A 403 from the setup script means the account is not selected for this session
or the user is not on its access list; a 404 means it was disconnected.

## API

All calls are `GET` with `Authorization: Bearer $PLAUD_ACCESS_TOKEN` against
`$PLAUD_API_BASE_URL` (`https://platform.plaud.ai/developer/api`).

```bash
source ~/.plaud/nuphos.env
plaud() { curl -sS --fail-with-body -H "Authorization: Bearer $PLAUD_ACCESS_TOKEN" -H 'Accept: application/json' "$PLAUD_API_BASE_URL$1"; }

plaud /open/third-party/users/current                  # the connected account
plaud '/open/third-party/files/?page=1&page_size=20'   # newest recordings first
plaud "/open/third-party/files/<fileId>"               # one recording, with content blocks
```

`files/` also takes `start_date` and `end_date` as epoch milliseconds
(inclusive) to filter by recording time. Page with `page` until a page comes
back short. To find a recording by name, list a date range and match `name`
locally; there is no server-side text search.

A recording carries `id`, `name`, `created_at`, `start_at`, `duration`
(seconds), `presigned_url` (a temporary audio URL, when available),
`source_list` and `note_list`:

| Where       | `data_type`          | What it is                                     |
| ----------- | -------------------- | ---------------------------------------------- |
| source_list | `transaction`        | Transcript segments                            |
| source_list | `transaction_polish` | Cleaned-up transcript                          |
| source_list | `outline`            | Topic outline with timestamps                  |
| source_list | `mark_memo`          | Moments flagged with the device's highlight key |
| note_list   | `auto_sum_note`      | The AI summary (markdown)                      |

Each block holds its content inline in `data_content`, or behind a short-lived
signed URL in `data_link` — fetch that URL with plain `curl` and **no**
Authorization header. Transcript content is a JSON array of segments with
`start_time` / `end_time` (milliseconds), `speaker` and `content`:

```bash
source ~/.plaud/nuphos.env
plaud "/open/third-party/files/$FILE_ID" | python3 -c '
import json, sys, urllib.request
file = json.load(sys.stdin)
file = file.get("data", file)
block = next((b for b in file.get("source_list") or [] if b.get("data_type") == "transaction"), None)
if not block:
    raise SystemExit("No transcript yet; available: %s" % [b.get("data_type") for b in file.get("source_list") or []])
raw = block.get("data_content") or urllib.request.urlopen(block["data_link"]).read().decode()
for seg in json.loads(raw):
    ms = seg.get("start_time") or 0
    print("[%02d:%02d] %s: %s" % (ms // 60000, ms // 1000 % 60, seg.get("speaker") or "?", seg.get("content", "")))
'
```

Prefer the `auto_sum_note` summary when the user only needs the gist; read the
transcript for quotes, action items or details the summary may drop. A new
recording may not have a transcript or summary until Plaud finishes processing
it.

## Errors

- **401**: the token expired; rerun the setup command. If it persists, the user
  revoked access in Plaud and an administrator must reconnect Plaud.
- **Empty `source_list`**: the recording has not been transcribed yet.
