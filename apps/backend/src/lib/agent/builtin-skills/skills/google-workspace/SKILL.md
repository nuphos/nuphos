---
name: google-workspace
description: "Read and act on the sender's own Gmail, Google Drive and Calendar: search, draft and send mail; find, read and share files; manage events. Uses their Personal Credential."
---

# google-workspace

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Gmail, Drive and Calendar are a member's private data, not team resources. The token is
always the session owner's, and only in their own conversations: when a
teammate sends the message in someone else's session, the handout answers 403
`personal_credential_owner_only`; tell them to ask from a conversation they own. Read only what the request needs, and never copy mail or file
contents anywhere the member did not ask for. Sending mail, deleting, trashing,
sharing and inviting people to events are irreversible or outward-facing: do them only when the member
asked for that specific action, and never add recipients they did not name.
Gmail filters silently reroute, label, archive or delete future mail: before
creating, changing or deleting one, show the member its exact criteria and
actions and wait for them to confirm, even when they asked for a filter.

## Setup

Run once per conversation, and again on a 401 (tokens last about an hour).
`<teamId>` is the current team id from the session context:

```bash
bash skills/google-workspace/scripts/setup-credentials.sh <teamId> gmail          # -> ~/.google/gmail.env
bash skills/google-workspace/scripts/setup-credentials.sh <teamId> google-drive   # -> ~/.google/google-drive.env
bash skills/google-workspace/scripts/setup-credentials.sh <teamId> google-calendar  # -> ~/.google/google-calendar.env
```

They write `GMAIL_ACCESS_TOKEN` / `GOOGLE_DRIVE_ACCESS_TOKEN` /
`GOOGLE_CALENDAR_ACCESS_TOKEN` and the account
email. Never print the token. Every shell call is a fresh process, so source the
env file in each call that uses it.

A 404 `personal_credential_not_connected` means this member has not connected
that provider through this team: ask them to connect Gmail, Google Drive or Google Calendar under
Settings → Personal Credentials, then retry. A 403
`personal_credential_not_selected` means the member has connected it, but it is
not selected for this conversation: ask them to select it with
`request_user_decision` (category `integration`, `credentials`
`[{provider: "personal", id: "gmail"}]`, or `google-drive` / `google-calendar`),
then retry. Do not tell them to reconnect it. A 409
`google_oauth_client_not_configured` means the team has no Google OAuth client
yet: a team administrator adds one in Team settings (guide:
https://docs.nuphos.ai/connectors/google-workspace). There is no team fallback.

A 409 `personal_credential_via_composio` means the member connected through
Composio instead: there is no token, so skip the curl recipes below and run
Composio's Gmail / Google Drive / Google Calendar tools
(https://docs.composio.dev/toolkits/gmail,
https://docs.composio.dev/toolkits/googledrive,
https://docs.composio.dev/toolkits/googlecalendar) through Nuphos:

```bash
bash skills/google-workspace/scripts/composio.sh <teamId> GMAIL_FETCH_EMAILS '{"query":"is:unread newer_than:2d","max_results":20}'
bash skills/google-workspace/scripts/composio.sh <teamId> GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID '{"message_id":"<id>"}'
bash skills/google-workspace/scripts/composio.sh <teamId> GMAIL_CREATE_EMAIL_DRAFT '{"recipient_email":"…","subject":"…","body":"…"}'
bash skills/google-workspace/scripts/composio.sh <teamId> GMAIL_ADD_LABEL_TO_EMAIL '{"message_id":"<id>","remove_label_ids":["UNREAD"]}'
bash skills/google-workspace/scripts/composio.sh <teamId> GOOGLEDRIVE_FIND_FILE '{"q":"name contains '"'"'roadmap'"'"' and trashed = false"}'
bash skills/google-workspace/scripts/composio.sh <teamId> GOOGLEDRIVE_DOWNLOAD_FILE '{"fileId":"<id>","mime_type":"text/plain"}'
bash skills/google-workspace/scripts/composio.sh <teamId> GOOGLECALENDAR_EVENTS_LIST '{"calendarId":"primary"}'
```

`GOOGLEDRIVE_DOWNLOAD_FILE` also exports Google Docs and Sheets; `mime_type`
(`text/plain`, `text/csv`, `text/markdown`, …) picks the format and is ignored
for regular files. Composio's tool names and arguments do not match the REST
paths below, so take any other tool's exact slug and arguments from the toolkit
pages above rather than guessing; an unknown one fails with `Tool … not found`.

Each prints `{"successful":…,"data":…,"error":…}`. Only `GMAIL_*`,
`GOOGLEDRIVE_*` and Google Calendar event tools run. Permanent mail deletion is refused (trash
instead), and so are Calendar tools that share, create, change or delete whole calendars. The same rules apply: prefer a draft (`GMAIL_CREATE_EMAIL_DRAFT`) over
`GMAIL_SEND_EMAIL` unless the member asked to send.

## Gmail

Scopes: `gmail.modify` — read, label, archive, trash, draft and send;
`gmail.settings.basic` — create, list and delete filters; `contacts.readonly` —
look up the member's contacts (People API, read only). Permanent delete is not
allowed.

```bash
source ~/.google/gmail.env
gmail() { curl -sS --fail-with-body -H @<(printf 'Authorization: Bearer %s\n' "$GMAIL_ACCESS_TOKEN") "https://gmail.googleapis.com/gmail/v1/users/me$1" "${@:2}"; }

gmail '/messages?q=is:unread%20newer_than:2d&maxResults=20'   # Gmail search syntax in q
gmail '/messages/<id>?format=full'                             # headers + MIME parts (base64url bodies)
gmail '/threads/<threadId>?format=metadata&metadataHeaders=Subject&metadataHeaders=From'
gmail '/messages/<id>/modify' -X POST -H 'Content-Type: application/json' \
  -d '{"removeLabelIds":["UNREAD"]}'
```

To draft or send, build an RFC 2822 message, base64url-encode it as `raw`, and
POST `/drafts` (`{"message":{"raw":…}}`) or `/messages/send` (`{"raw":…}`). For
a reply, set `In-Reply-To` and `References` from the original's `Message-ID`
and pass its `threadId`. Prefer a draft unless the member asked to send.

Filters live under `/settings/filters` (GET to list, POST
`{"criteria":…,"action":…}` to create, DELETE `/settings/filters/<id>`). Look
up contacts with the People API:
`https://people.googleapis.com/v1/people:searchContacts?query=<name>&readMask=names,emailAddresses`
(same bearer token). A connection made before these scopes were added must be
reconnected once; until then those calls return 403.

## Google Drive

Scope: `drive` — full access to the member's Drive and shared drives they can
reach.

```bash
source ~/.google/google-drive.env
drive() { curl -sS --fail-with-body -H @<(printf 'Authorization: Bearer %s\n' "$GOOGLE_DRIVE_ACCESS_TOKEN") "https://www.googleapis.com/drive/v3$1" "${@:2}"; }

drive "/files?q=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("name contains '"'"'roadmap'"'"' and trashed = false"))')&fields=files(id,name,mimeType,modifiedTime,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true"
drive '/files/<id>?fields=id,name,mimeType,owners,webViewLink&supportsAllDrives=true'
drive '/files/<id>?alt=media' -o file.bin                       # binary / non-Google files
drive '/files/<id>/export?mimeType=text/plain'                  # Google Docs as text
drive '/files/<id>/export?mimeType=text/csv'                    # first sheet of a Google Sheet
```

Upload with `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`
(metadata JSON part + content part). Share with `POST /files/<id>/permissions` only
when the member asked and named who to share with.

## Google Calendar

Scope: `calendar.events` — read, create, update and delete events on calendars
the member can reach. It cannot share calendars or change their settings.

```bash
source ~/.google/google-calendar.env
gcal() { curl -sS --fail-with-body -H @<(printf 'Authorization: Bearer %s\n' "$GOOGLE_CALENDAR_ACCESS_TOKEN") "https://www.googleapis.com/calendar/v3$1" "${@:2}"; }

gcal "/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=$(date -u +%Y-%m-%dT%H:%M:%SZ)&maxResults=20"
gcal '/calendars/primary/events/<eventId>'
gcal '/calendars/primary/events' -X POST -H 'Content-Type: application/json' \
  -d '{"summary":"…","start":{"dateTime":"2026-01-05T10:00:00+08:00"},"end":{"dateTime":"2026-01-05T10:30:00+08:00"}}'
```

Use the member's time zone for times. Propose the event (title, time, guests)
and create it only when the member asked; add `attendees` only for people they
named, and pass `sendUpdates=none` unless they asked to notify guests.
