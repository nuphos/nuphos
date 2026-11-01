---
name: google-workspace
description: Read and act on the message sender's own Gmail and Google Drive — search, read, label, draft and send mail; search, read, upload, and share Drive files and Google Docs/Sheets — through the Gmail or Google Drive Personal Credential the member connected in Nuphos Settings. Use whenever the user asks about their email or inbox, wants a reply drafted or sent, or asks to find, read, or save a file in their Google Drive. Nuphos hands the agent a short-lived Google access token; the agent calls the Gmail and Drive REST APIs directly with curl.
---

# google-workspace

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Gmail and Drive are a member's private data, not team resources. The token is
always the session owner's, and only in their own conversations: when a
teammate sends the message in someone else's session, the handout answers 403
`personal_credential_owner_only`; tell them to ask from a conversation they own. Read only what the request needs, and never copy mail or file
contents anywhere the member did not ask for. Sending mail, deleting, trashing
and sharing are irreversible or outward-facing: do them only when the member
asked for that specific action, and never add recipients they did not name.

## Setup

Run once per conversation, and again on a 401 (tokens last about an hour).
`<teamId>` is the current team id from the session context:

```bash
bash skills/google-workspace/scripts/setup-credentials.sh <teamId> gmail          # -> ~/.google/gmail.env
bash skills/google-workspace/scripts/setup-credentials.sh <teamId> google-drive   # -> ~/.google/google-drive.env
```

They write `GMAIL_ACCESS_TOKEN` / `GOOGLE_DRIVE_ACCESS_TOKEN` and the account
email. Never print the token. Every shell call is a fresh process, so source the
env file in each call that uses it.

A 404 `personal_credential_not_connected` means this member has not connected
that provider through this team: ask them to connect Gmail or Google Drive under
Settings → Personal Credentials, then retry. A 409
`google_oauth_client_not_configured` means the team has no Google OAuth client
yet: a team administrator adds one in Team settings (guide:
https://docs.nuphos.ai/connectors/google-workspace). There is no team fallback.

## Gmail

Scope: `gmail.modify` — read, label, archive, trash, draft and send. Permanent
delete is not allowed.

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
