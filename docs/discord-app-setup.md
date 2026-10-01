# Discord app setup

This document configures the Discord application used by the Nuphos backend.
The conversation entry point is a direct mention of the installed bot. Slash
commands manage channel access and per-user thread permission modes. Once a
thread starts, replies do not require mentions. The same addressing judge as
Slack decides whether an unmentioned reply needs the agent to respond.

## Developer Portal

1. Create a Discord application and add a bot user.
2. On **OAuth2 > General**, add this redirect URL:
   `https://<backend-host>/discord-app/setup`.
3. Enable **Require OAuth2 Code Grant**. The install callback uses the guild
   returned by Discord to bind exactly one server to a Nuphos team.
4. Interactions work over the Gateway by default. Alternatively, on **General
   Information**, set `https://<backend-host>/discord/interactions` as the
   interactions endpoint. Both paths acknowledge commands and approval buttons
   before doing database work. HTTP requests require `DISCORD_PUBLIC_KEY`.
5. On **Bot**, enable **Message Content Intent** before deploying this version.
   The Gateway now requests that privileged intent to read unmentioned replies
   in registered threads. Verified apps need Discord approval for this intent.
   Without it, Discord rejects the Gateway connection with code 4014.
   **Server Members Intent** is not required.

The generated install URL requests `identify`, `bot`, and
`applications.commands`. Its bot permission bitset includes only:

- View Channels
- Send Messages
- Read Message History
- Create Public Threads
- Send Messages in Threads

Do not grant Administrator permission.

## Backend environment

Set these values on every backend replica:

```dotenv
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_OAUTH_REDIRECT=https://<backend-host>/discord-app/setup
DISCORD_PUBLIC_KEY=
```

`DISCORD_PUBLIC_KEY` is the application's Ed25519 public key from **General
Information**. The backend verifies every interaction request before processing
an approval.

## Smoke test

1. In Nuphos, open **Add integration > Discord** and complete the browser flow.
2. Invite the bot to the intended server when Discord prompts for a server.
3. In the intended text channel, a linked Nuphos team administrator who also
   has Discord's **Manage Channels** permission runs `/nuphos enable`.
4. Mention the bot: `@Nuphos summarize this channel`. The bot creates a public
   thread for the conversation. Mentions in a disabled channel produce no reply,
   thread, or typing indicator, including mentions from unlinked users.
5. A different Nuphos member should use the same Discord integration dialog to
   link their Discord identity before mentioning the bot.
6. New Discord and Slack conversations default to **Full Access** and all
   credentials the acting member is allowed to use. Inside a Discord thread,
   use `/nuphos auto` or `/nuphos full-access` to change your own permission mode;
   other members retain their own mode. Existing explicit mode choices survive
   subsequent turns. In Auto Mode, trigger a tool that requires approval and verify that only the linked user
   whose credentials the current turn uses can approve or deny the request.
   Confirm both buttons respond promptly with and without an HTTP interactions endpoint.
7. Run `/nuphos disable` and verify that later mentions remain silent and any
   pending approvals in that channel are invalidated.

For local testing, the OAuth redirect must still be reachable by Discord and
must exactly match `DISCORD_OAUTH_REDIRECT`. The bot also needs a running Gateway
connection; the backend coordinates a single active Gateway owner through a
MongoDB lease so multiple replicas do not process the same event concurrently.

8. Reply in the thread without mentioning the bot. Follow-up questions should
   receive answers; conversation between humans should stay silent. During an
   agent turn Discord shows its native typing indicator, refreshed every eight
   seconds and stopped on completion or failure.
9. Return to Nuphos after OAuth: Connectors should list the Discord server,
   enabled channel count, and your account link status. Open it to see details.

API behavior: [interaction acknowledgements](https://docs.discord.com/developers/interactions/receiving-and-responding)
and [privileged Gateway intents](https://docs.discord.com/developers/events/gateway).

## Disconnect or switch servers

In Nuphos, open the Discord connection under **Connectors** and choose
**Disconnect**. Only a Team administrator can disconnect it. Then use **Add
connector → Discord** to select another server.

Disconnect removes the Team's server, channel, and account links and rejects
pending approvals. Outstanding OAuth callbacks are invalidated, and old threads
cannot resume against a new installation. Historical messages remain in Discord
and Nuphos. The shared bot is not removed from Discord itself; a server admin can
remove it there separately. New installations require channels to be enabled and
members to link their accounts again.
