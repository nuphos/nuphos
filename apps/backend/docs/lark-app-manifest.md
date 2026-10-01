# Lark (Feishu) app configuration

The authoritative setup for the Nuphos Lark connector. It is **custom-app only**:
there is **no** global Nuphos Lark app and no OAuth install flow. Each Nuphos team
creates its own custom app (企业自建应用 / "custom app") in its Feishu or Lark
developer console and pastes that app's `app_id` / `app_secret` / event **Encrypt
Key** into the Nuphos desktop app (Connectors → Lark). Credentials are encrypted
at rest per binding; inbound events are routed by the `app_id` carried in the
webhook URL.

Feishu (China, `open.feishu.cn`) and Lark (Global, `open.larksuite.com`) are
separate platforms and API hosts, chosen per binding via `domain`
(`feishu` / `larksuite`) — different teams may point at different sites.

## Onboarding (admin)

1. Create a **custom app** in the Feishu / Lark developer console.
2. Copy the **App ID** (`cli_…`) and **App Secret**.
3. Enable **Event Subscription**, turn on encryption, and generate an **Encrypt
   Key** (optionally set a Verification Token).
4. In the Nuphos desktop app, Connectors → Lark → **Connect Lark**: pick the site,
   paste the credentials. The backend verifies them (mints a
   `tenant_access_token`) before storing.
5. Nuphos returns the app-specific **Event Request URL**
   `https://<backend-host>/lark/events/<app_id>`. Put it back into the app's
   Event Subscription request URL, subscribe to the events below, grant the
   scopes below, and **publish a version**.
6. **Add the bot to a group** — it links automatically (no chat-id copying) and
   appears under Groups in the desktop. Then @mention the bot in the group and it
   replies. To DM the bot 1:1, first link your account: Connectors → Lark → **Link
   your Lark account** → generate a pairing code → DM it to the bot.

## Message + thread behavior

- **Group @mention**: the bot only receives group messages when it is @mentioned
  (`im.message.receive_v1`). Each @mention starts an agent turn; the reply is a
  threaded reply (`reply_in_thread`) and the same thread reuses one agent session
  (keyed by the thread root message id). A group **auto-links** the first time the
  bot is added or @mentioned — the app belongs to one team, so any group its bot
  is in is that team's. Admins can disable a group in the desktop (a sticky mute).
- **1:1 DM (p2p)**: no @ needed, no threads — one ongoing session per DM (keyed by
  `chat_id`). The sender must resolve to a Nuphos user first: a custom app's tenant
  token can't read a sender's email (Feishu gates it behind user-level OAuth), so
  there's no email auto-map — each member links themselves by generating a **pairing
  code** in the desktop app (Connectors → Lark → Link your Lark account) and DMing
  it to the bot. The code is single-use and expires in 10 minutes.
- **Reply rendering**: the agent's visible text is the reply, streamed into a
  minimal interactive card (reply once, then `PATCH` it as the run progresses;
  only the final result remains when done).

## Proactive posting (agent tool)

Independent of any @mention, a running agent can post to a Lark group via two
tools (registered whenever the team has Lark connected; they return a structured
`lark_not_connected` blocker otherwise):

- **`lark_list_destinations`** — lists the groups the bot is a member of
  (`im/v1/chats`), returning `{ chatId, name }` per group.
- **`lark_post`** — sends a message to a `chatId` returned by
  `lark_list_destinations` (never a name, never a guessed id).

## Permissions (scopes)

Grant in the developer console → Permissions:

| Scope                                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `im:message:send_as_bot`                   | Send / reply as the bot, `PATCH` the interactive card                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `im:message.group_at_msg` (or `:readonly`) | Receive group messages that @mention the bot                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `im:message.p2p_msg:readonly`              | Receive 1:1 DM messages ("读取用户发给机器人的单聊消息"). Per the official `im.message.receive_v1` event doc, ANY one of the message scopes suffices for delivery — `:readonly` included — so this alone triggers p2p events. The un-suffixed `im:message.p2p_msg` still appears in that event doc but the console's batch scope import rejects it as nonexistent (2026-08-13); an earlier note here claimed only the full scope delivered DM events ("confirmed 2026-07-25"), which the official doc contradicts. |
| `im:chat:readonly`                         | List the groups the bot is in (Groups picker + `lark_list_destinations`)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `contact:contact.base:readonly`            | `/contact/v3/users` lookup — sender **display name** only. A custom app's tenant token can **not** read a user's email (Feishu gates email behind user-level OAuth): `contact:contact.base:readonly` returns the user with a null email, `contact:contact` is rejected by the read API (403, code 99991672), and `contact:user.email:readonly` / `contact:user.base:readonly` are rejected too. So there is **no** email auto-map — members self-link with a DM pairing code.                                      |

`contact:contact.base:readonly` is an optional enhancement: without it the sender
name falls back to "a teammate" (account linking is unaffected — that's the DM
pairing code, not this scope). Without `im:chat:readonly` the desktop Groups
picker can't enumerate chats (it falls back to the auto-linked list) and
`lark_list_destinations` returns an error.

## Event subscription

- **Transport**: webhook. Feishu POSTs to
  `https://<backend-host>/lark/events/<app_id>` (public HTTPS). The `app_id` must
  be in the URL — an encrypted event body hides it until decrypted, so the
  backend routes by URL, then verifies + decrypts with that binding's Encrypt Key.
- **Encrypt Key — required**: Nuphos fails closed on Lark events. The backend
  verifies `X-Lark-Signature` (`sha256(timestamp+nonce+encryptKey+body)`) and
  decrypts `{"encrypt": base64(iv + AES-256-CBC(sha256(encryptKey), event))}`.
- **Verification Token**: optional; when set, the `url_verification` handshake is
  additionally token-checked.
- **Subscribed events**:
  - `im.message.receive_v1` — inbound messages (@mentions + DMs).
  - `im.chat.member.bot.added_v1` — bot added to a group → auto-link it.
  - `im.chat.member.bot.deleted_v1` — bot removed from a group → unlink it.
- **URL verification handshake**: on saving the request URL, Feishu sends
  `url_verification` (encrypted + signed); the backend verifies, decrypts, and
  echoes the `challenge`.

## Backend configuration

Lark uses per-team credentials, so there are **no app-level env vars** — only the
key that encrypts each team's stored credentials at rest:

| Item                                                      | Location                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| App ID / Secret / Encrypt Key / Verification Token / site | Each team's binding (entered in the desktop form, encrypted at rest)      |
| Credential encryption key                                 | `LARK_TOKEN_ENCRYPTION_KEY` (falls back to `LINEAR_TOKEN_ENCRYPTION_KEY`) |
| Event Request URL (per team)                              | `https://<backend-host>/lark/events/<app_id>`                             |
