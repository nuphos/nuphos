# Message attribution (version 1)

Human messages accepted through Nuphos chat or a mapped Slack account carry a
server-authored `metadata` object, separately from their original `parts`:

```json
{
  "version": 1,
  "sender": { "type": "user", "id": "nuphos-user-id", "displayName": "Yuan" },
  "source": "nuphos",
  "sentAt": "2026-09-27T10:00:00.000Z"
}
```

`sender.id` is the Nuphos user ID, including for Slack messages. `displayName` is
a snapshot taken when accepted; `sentAt` is the server receipt timestamp, not a
client-controlled clock. `source` is `nuphos` or `slack`. Existing Slack `origin`
continues to carry Slack channel/thread/user identifiers independently.

The backend restores historical attribution by message ID from storage and
stamps only the current submitted user message from the authenticated actor.
Resume/continuation requests do not stamp old messages. Transcript sync ignores
client-supplied attribution and preserves already stored metadata, including
when messages are reordered. Verified historical user messages keep their stored
role and body, so editing a client copy cannot impersonate the original author.
Legacy history stays unattributed.

At the model boundary, a shared serializer prepends:

```text
<nuphos_message_metadata>
{"version":1,"sender":{"type":"user","id":"nuphos-user-id","displayName":"Yuan"},"source":"nuphos","sentAt":"2026-09-27T10:00:00.000Z","messageId":"message-id"}
</nuphos_message_metadata>

Original text
```

The JSON escapes `<` so labels cannot terminate the envelope. User content is
never parsed as authoritative metadata. This representation is descriptive,
not an authorization boundary: tool access still uses the execution principal.
New prompts, queued inputs, reconstructed history and transcript lookup use the
same renderer. Summarization instructions request preserving author IDs; this
is model behavior, not a guarantee of lossless native compaction.

Desktop reads the structured API/SSE field, displays the author and Slack
source, and merges server attribution onto optimistic messages. No prefix is
stored in message parts, copied into the clipboard, or shown as chat text.
Unknown/legacy authors have no author label. Other clients can consume the
additive API field; iOS/Android rendering is not changed by this implementation.

Team members can now participate in shared-agent sessions as described below.
Local Agent sessions and owner-only management controls retain their access boundaries.

## Profile and runtime identity

Sender metadata may include an optional trusted Google CDN `avatarURL` for client rendering. The model envelope omits this field. Names and avatars are snapshots when a message is sent; profile edits apply to subsequent messages. Desktop displays the name above the bubble and a circular avatar beside it, with initials when no image is available.

Profile settings update the signed-in account's display name, username and avatar URL through authenticated `PATCH /auth/me`. Email and user ID cannot be reassigned through this endpoint. Explicit profile edits survive later Google sign-ins. Self-service avatar URLs are restricted to HTTPS on lh3–lh6.googleusercontent.com with no credentials or custom ports. Metadata parsing and desktop message rendering enforce the same restriction; arbitrary URLs fall back to initials.

A native runtime may supply its provider login email in its own context. That account is not evidence of the Nuphos participant's identity. The Nuphos prompt explicitly distinguishes these identities, and changed system instructions refresh existing sessions before the next admitted prompt. This is a model instruction boundary; it does not remove provider-injected account context or provide credential isolation.

## Shared-agent conversations

Current team members can send messages in a teammate's shared-agent session. The conversation owner remains the storage and stream-routing identity; the authenticated sender is the execution principal for credentials, memory and approvals. New turns in existing sessions preserve canonical server history and append only the fresh user message, so a stale or edited client transcript cannot replace another participant's exchanges.

Local Agent sessions remain private to the computer owner. Cross-team and unscoped private conversations remain inaccessible. Runtime/model settings, credential selection, transcript replacement and feedback remain owner-only. A teammate can stop or steer their own active turn; another participant's active turn must finish before a new sender takes over.
