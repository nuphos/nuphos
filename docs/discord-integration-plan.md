# Discord integration: Slack research and implementation plan

> Implementation update (2026-09-16): the follow-up conversation fixes implement
> ordinary thread replies with the Slack addressing judge, native typing,
> `/nuphos full-access|auto`, deferred HTTP/Gateway interactions, and connector
> inventory display. Slack and Discord turns default to Full Access and all
> actor-authorized credentials. Disabled channels stay silent. Message Content
> Intent must now be enabled before deployment; see [current setup](discord-app-setup.md).
> The phase descriptions below retain the original rollout proposal.

Status: phase 1 implementation in progress; no external Discord configuration changed.
Researched: 2026-09-16. Baseline: Nuphos `ec040919`, OpenAB gitlink `784b8bfe65e55636f4ba45d5f40f97d4a388ed24`.
Worktree: `/Users/yuanlin/Developer/nuphos-discord-integration-plan`; branch: `docs/discord-integration-plan`.

## Recommendation

Build Discord as a Nuphos backend conversation adapter using the existing agent turn runner, identity checks, durable conversations, and decision services. The required entry experience is: invite the bot to a server, mention it with a request, and receive its answer in a thread. Gateway ingestion for mentions is part of the first release, alongside guild installation, account linking, and approval buttons over HTTP interactions. Conversation initiation must not require a slash command. Ordinary thread replies without a mention follow when Message Content access is available. Desktop handoff and proactive notifications follow once conversation binding is safe.

Initial scope is one Discord guild per Nuphos team and one owning team per guild. Cross-team channel grants, DMs, forum/private-thread support, and Discord-wide search are deferred. A first mention before setup is complete should receive a concise connection/linking prompt, so invitation never leads to a silently unresponsive bot.

The existing OpenAB Discord adapter is a useful protocol reference, but enabling it alone would create a separate entry point into OpenAB sessions without establishing Nuphos team identity, actor credentials, approval authorization, billing context, or desktop transcript protection. Keep Discord ingress in Nuphos and continue using OpenAB through the existing runtime path.

## How Slack currently works

The production-shaped integration lives in the TypeScript backend and Electron app; it is distinct from OpenAB's own Slack/Discord adapters.

| Layer                | Observed behavior                                                                                                                                                                                                                                        | Source                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation         | Team administrators start OAuth; a ten-minute, single-use state binds the callback to its requester/team. Callback encrypts a workspace bot token, prevents workspace ownership conflicts, checks reinstall workspace identity, and links the installer. | [installation routes](../apps/backend/src/routes/slack-installations.ts), [callback](../apps/backend/src/routes/slack-app.ts), [indexes](../apps/backend/src/models/indexes-core.ts)                                          |
| Desktop setup        | Electron opens the installation flow and matches `nuphos://slack-callback` against pending state. Settings manages installation, channels, and account mappings.                                                                                         | [Electron install](../apps/desktop/electron/slack-install.ts), [settings hook](../apps/desktop/src/views/slack-settings/useSlackSettings.ts)                                                                                  |
| Ingress              | `/slack/events`, `/slack/interactions`, and `/slack/commands` serve platform traffic; event ingress verifies the raw request signature, claims an event, acknowledges, and dispatches asynchronous work with lease refresh.                              | [route registration](../apps/backend/src/routes/slack.ts), [events](../apps/backend/src/routes/slack/events.ts), [interactions](../apps/backend/src/routes/slack/interactions.ts)                                             |
| Routing and identity | Workspace installation selects a bot; channel mapping selects a team; Slack user mapping selects a Nuphos actor. Email can auto-link a matching team member. Cross-team channel grants have additional authorization rules.                              | [mention handler](../apps/backend/src/routes/slack/mention.ts), [identity](../apps/backend/src/routes/slack/identity.ts), [mapping authorization](../apps/backend/src/lib/slack/mapping-authorization.ts)                     |
| Conversations        | `(workspace, channel, thread timestamp)` binds to a durable Nuphos session and its original owner. A teammate's reply executes with that teammate's credentials, not the owner's. DMs have assistant lifecycle/context handling.                         | [records](../apps/backend/src/lib/slack/agent-bot/collections.ts), [thread access](../apps/backend/src/lib/slack/thread-access.ts), [assistant lifecycle](../apps/backend/src/routes/slack/assistant-lifecycle.ts)            |
| Turn admission       | A shared per-session claim runs or queues incoming messages; new input can supersede a blocked permission request. Thread replies also pass team-access and addressing gates.                                                                            | [admission](../apps/backend/src/routes/slack/turn-admission.ts), [thread gates](../apps/backend/src/routes/slack/thread-gates.ts)                                                                                             |
| Execution and output | `turnRunner.runAgentForTrigger` executes within Nuphos; a frame sink posts incremental answer segments and status. The completion path delivers plan/permission cards and produced files.                                                                | [turn](../apps/backend/src/routes/slack/turn.ts), [runner seam](../apps/backend/src/lib/agent/turn-runner.ts), [sink](../apps/backend/src/lib/slack/stream-sink.ts)                                                           |
| Approvals            | Tool decisions resolve the existing pending wait and require the linked principal whose credentials are in use; plans and permission grants have their own handlers. Card delivery failure rejects a synchronous tool wait.                              | [tool decisions](../apps/backend/src/routes/slack/tool-approval-decide.ts), [plan decisions](../apps/backend/src/routes/slack/plan-approve.ts), [permission decisions](../apps/backend/src/routes/slack/permission-decide.ts) |
| Desktop continuity   | Slack-bound desktop turns share admission, merge persisted history, and mirror output. Transcript replacement is blocked for bound sessions to prevent stale desktop clients deleting messages. Pickup explicitly binds an existing conversation.        | [bound chat](../apps/backend/src/routes/agent/chat-slack-bound.ts), [pickup](../apps/backend/src/lib/slack/session-pickup.ts)                                                                                                 |
| Proactive delivery   | Team-scoped destination and posting hooks enforce installation/channel grants, delivery reservation, budgets, and notification thread binding.                                                                                                           | [outbound entry](../apps/backend/src/lib/slack/agent-outbound.ts), [outbound modules](../apps/backend/src/lib/slack/agent-outbound/), [incident notifications](../apps/backend/src/lib/slack/incident-notifications.ts)       |

Two implementation lessons: preserve the separation between conversation owner and current actor, and treat transport delivery separately from executing a turn. Slack's event claim plus detached promise is not itself a durable job queue; do not assume an acknowledged event survives process termination.

Additional repository references: [Slack app manifest](../apps/backend/docs/slack-app-manifest.md), [runtime routing](openab-runtimes.md), and [Lark pairing](../apps/backend/src/lib/lark/agent-bot-pairing.ts). Lark already demonstrates expiring, one-time account pairing if a future non-OAuth linking path is needed.

OpenAB's pinned `crates/openab-core/src/discord.rs` and `docs/discord.md` were inspected through `git show` using the initialized submodule in the original checkout. The new worktree's submodule remains uninitialized; the original checkout has unrelated local changes, so those changes are not part of this baseline.

## Discord constraints that change the design

| Difference                                                                                                                                                                       | Design consequence                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button interactions arrive through either HTTP interactions or Gateway interactions. Initial response is required within three seconds; interaction tokens last fifteen minutes. | Choose HTTP for button interactions and defer promptly. Mentions arrive as Gateway message events, use bot-authenticated replies, and are not subject to the interaction-token deadline. [Interaction protocol](https://docs.discord.com/developers/interactions/receiving-and-responding) |
| HTTP requests use Ed25519 signatures over timestamp plus raw body.                                                                                                               | Verify before parsing/dispatch, answer signed PINGs, reject invalid signatures, and deduplicate interaction IDs. [Endpoint verification](https://docs.discord.com/developers/interactions/overview)                                                                                        |
| Discord bot credentials belong to the application; installation does not issue a Slack-style bot token per guild. The callback guild ID is only a hint.                          | Keep the application token in server secrets. Use authorization-code installation and authoritative guild verification before binding a tenant. [OAuth2](https://docs.discord.com/developers/topics/oauth2)                                                                                |
| A bot cannot infer a user's Nuphos account from a Slack-style member-email lookup.                                                                                               | Link via authenticated Nuphos state plus Discord OAuth `identify`; map the returned immutable user ID. Never match display names. [OAuth scopes](https://docs.discord.com/developers/topics/oauth2)                                                                                        |
| Ordinary guild message content requires the privileged Message Content intent; mentions and app DMs have exceptions.                                                             | Launch with Gateway direct mentions without depending on privileged Message Content access. Until that access is enabled/approved as applicable, follow-ups also mention the bot. No REST-history workaround. [Gateway intents](https://docs.discord.com/developers/events/gateway)        |
| A Discord thread is a channel with its own ID and lifecycle. Sending in threads requires `SEND_MESSAGES_IN_THREADS`.                                                             | Persist parent and thread IDs separately; handle archived, locked, deleted, and inaccessible threads explicitly. [Threads](https://docs.discord.com/developers/topics/threads)                                                                                                             |
| Message content has a 2,000-character limit; rendering and attachments differ from Slack.                                                                                        | Add a Discord renderer with safe splitting, code-fence preservation, and `allowed_mentions` disabled by default. Apply Discord-specific attachment limits. [Message API](https://docs.discord.com/developers/resources/message)                                                            |
| Rate limits include route buckets and bot-wide limits.                                                                                                                           | Coordinate outbound requests across processes, respect retry headers, and coalesce edits/status updates. [Rate limits](https://docs.discord.com/developers/topics/rate-limits)                                                                                                             |

## Proposed architecture and records

```text
Discord HTTP interactions ── signature + dedupe ──┐
                                                ├─ durable inbox → team/channel/actor checks
Discord Gateway worker ── message-ID dedupe ──────┘                  ↓
                                                     session binding + shared turn claim
                                                                   ↓
                                                      existing Nuphos turnRunner
                                                                   ↓
                                                  Discord sink → outbound dispatcher
                                                                   ↓
                                                       bot REST → Discord thread
```

These are proposed modules, not existing APIs:

- `routes/discord.ts`, `routes/discord-app.ts`, and team-scoped `routes/discord-installations.ts`: HTTP interactions, install/link callbacks, status, channels, and disconnect.
- `lib/discord/{api,oauth,installations,identity,agent-bot,stream-sink}.ts`: platform protocol and storage boundaries.
- `routes/discord/{mention,thread-message,turn,turn-admission,decisions}.ts`: normalized input, actor authorization, execution, and cards.
- A separate Gateway worker entry point: maintain heartbeat/resume and shard ownership independently of HTTP replicas. Start with one leased owner; use Discord's recommended shard/session-start information as deployment scales. Select and pin a maintained SDK during implementation after checking backend runtime compatibility.
- Reuse the existing BullMQ/Redis infrastructure patterns for a Discord-specific inbox/outbox worker, after validating deployment availability. Persist Gateway messages before showing a receipt or beginning a turn; Gateway dispatch has no per-message HTTP acknowledgement. Persist interaction acceptance before acknowledging work; use a database outbox or reconciliation scanner to close database/queue publication gaps. Bound input payload retention and encrypt any retained interaction tokens.

Proposed collections and constraints:

| Record                     | Key and significant fields                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discord_installations`    | Unique guild ID and, initially, unique team ID; application ID, installer IDs, status, install generation, timestamps. Application secret reference only, no copied bot token per guild.                 |
| `discord_pending_oauth`    | Random state; operation (`install`/`link`), team/requester, expected guild, expiration; TTL plus explicit expiration check and atomic consumption.                                                       |
| `discord_channel_mappings` | Unique `(guildId, channelId)`; team, enabled, createdBy. Initially only channels in that team's installed guild.                                                                                         |
| `discord_user_mappings`    | Unique `(teamId, discordUserId)`; Nuphos user, enabled, linkedAt. Recheck current Nuphos membership per action.                                                                                          |
| `discord_agent_threads`    | Unique `(guildId, threadChannelId)`; parent channel, root message, team, session, owner, creator, origin, installation generation. Prevent multiple active transport bindings for one session initially. |
| `discord_events`           | Unique application/event key; interaction ID or message ID, payload reference, admission/run/delivery states, lease and attempts, expiry.                                                                |
| `discord_decisions`        | Opaque expiring reference to existing wait/plan/proposal; team, actor policy, session, exact guild/channel/message; atomic decision state.                                                               |
| `discord_deliveries`       | Stable delivery key, destination, payload hash, message ID, status, attempts. Resume delivery without rerunning agent/tool side effects.                                                                 |

All Discord snowflakes remain strings, including IPC, JSON, MongoDB, and logs. Do not convert them to JavaScript numbers. Use provider-tagged message origins and typed transport bindings rather than adding Discord values to Slack-named fields.

Extract only demonstrated shared seams: session admission, transcript conversion/merge/protection, and decision authorization. Keep Discord OAuth, rendering, rate limits, and thread lookup platform-specific. Preserve existing Slack source values and records; no bulk migration is required to launch Discord.

## Installation and authorization contract

1. A current Nuphos team administrator starts an installation. Record expiring state and the selected team; recheck role at completion. Configure guild installation with `bot`, `identify`, and `applications.commands` using the authorization-code flow, with code grant required. Register `/nuphos enable|disable` for channel administration; conversation initiation remains mention-only. Obtain the installer from `/users/@me`; verify the guild from the authoritative exchange and bot access, never from redirect query parameters alone.
2. Persist the guild/team binding under unique indexes. A changed guild during reinstall is rejected. An unbound guild where the public bot was invited has no access to Nuphos; its first mention returns only a rate-limited setup link. The link must lead through authenticated, verified installation rather than trusting guild/user IDs supplied in a URL. Installation alone never starts agent work.
3. Each teammate links their own account through a separate `identify` flow tied to their authenticated Nuphos session and team. Discard short-lived OAuth credentials once linking is complete unless a documented feature needs ongoing access. The verified installer can be linked automatically.
4. Admins explicitly enable or disable specific text channels with `/nuphos enable|disable`. Require both a linked Nuphos team administrator and Discord's effective Manage Channels (or Administrator) permission. Mentions never mutate channel access. Settings can also enable or disable channels explicitly. Validate guild ownership and effective bot permissions, including channel overrides. Start with View Channel, Send Messages, Read Message History, Create Public Threads, and Send Messages in Threads; add Embed Links, Attach Files, or Add Reactions only when their features ship. Do not request Administrator. [Permission model](https://docs.discord.com/developers/topics/permissions)
5. Every turn and decision validates active installation generation, channel grant, linked actor, current membership, and resource authorization. Execution uses that actor; persistence retains the conversation owner. Discord roles do not grant Nuphos infrastructure access.
6. Disconnect disables routing and pending actions immediately and invalidates cached grants; preserve conversation history. Bot removal or permanent access loss also disables delivery. A guild-unavailable event must be distinguished from actual removal. Reinstall must not revive stale cards/jobs. Never rotate the shared application token to disconnect one guild.

## Delivery phases and acceptance criteria

### 1. Installation and mention conversation MVP

Implement install/link/status/channel APIs, model indexes, verified HTTP button interactions, durable intake, and a Discord sink. Ship the Gateway worker now, with `GUILDS` and `GUILD_MESSAGES`, heartbeat/resume, leased connection ownership, message-ID dedupe, and permission-change handling. Ignore bot/webhook messages by default and trigger only on a direct mention of the bot's user ID. Add a Desktop Discord settings page and Electron callback/IPC wiring alongside the Slack equivalents. Respect the shared Toolbar and dual-host Settings conventions in `AGENTS.md`.

`@Nuphos investigate this error` in an enabled text channel creates a public thread from the user's message and starts a Nuphos conversation. A mention inside an existing supported thread binds that thread after access checks; in an already bound thread it continues the same session. Before executing tools, verify successful destination creation/access and persist the binding. A bare mention returns a short prompt asking what the user needs. Replies use bot REST. Until Message Content access enables ordinary follow-ups, tell users to mention the bot again in the thread; no slash command is required for conversation turns.

Support tool approval, plan review, and permission-grant decisions through existing services. Component IDs hold short opaque references, not serialized credentials or unrestricted session IDs. Recheck exact message location and the pending request's actor policy; consume atomically. Failed tool-card delivery rejects the pending wait. If a decision class is temporarily unsupported, reject or direct the user to an authorized Nuphos review surface without silently approving it.

Done when inviting/configuring the bot, explicitly enabling a channel, and mentioning it starts a conversation; two linked teammates can execute turns with different credentials in one thread; an unlinked/nonmember user cannot run or approve; duplicate/replayed Gateway messages produce one admitted turn; reconnects preserve bindings; invalid button signatures cause no decision; and a task lasting more than fifteen minutes still delivers its result. Mention-based setup/authorization notices are ordinary channel replies with no sensitive details; only interaction responses can be ephemeral. Missing send permissions surface in installation health because an in-channel reply may be impossible. Guild-thread output is visible to Discord channel viewers, so setup must make that audience clear.

### 2. Natural thread replies without repeated mentions

Extend the phase-1 Gateway worker to process ordinary replies in already bound threads. Request Message Content access only for this capability; keep direct mentions working independently. Use message ID for dedupe, not Gateway sequence alone.

Enable ordinary replies only with Message Content access; otherwise retain explicit mentions and display the limitation. Reuse the addressing judge only after adapting its provider context; an addressing verdict never substitutes for authorization. Restrict history reads to the authorized thread and explicit bounded context. Do not import ambient channel discussions automatically.

Done when plain replies continue the existing conversation, unrelated teammate chatter is filtered, mentions and ordinary replies share one admission path, and disabling Message Content access leaves mention-based conversation usable. Archived/locked/deleted threads must fail visibly from phase 1 without creating unintended replacement conversations. Recoverable archive reopening must be permission-checked. Lost Gateway sessions can create event gaps: document recovery limits from phase 1 and only reconcile bounded, already-bound thread history with permission and content access.

### 3. Desktop continuity and files

Generalize transport-bound lookup, server-authoritative transcript guards, shared claims, and message-origin rendering before allowing Discord conversations to be continued in desktop. Apply transcript replacement protection from phase 1 even if the UI handoff is deferred. Add a Discord thread link and explicit owner-initiated pickup; keep one active external binding per session initially. Pickup into a guild channel must warn about the audience and avoid automatically posting past private history.

Add inbound attachments and generated-file delivery using existing file-transfer primitives, Discord-specific size limits, content checks, download timeouts, and safe CDN handling. Never forward the application bot token to arbitrary attachment URLs. If upload fails, provide an authenticated Nuphos access path rather than a public file URL.

Done when concurrent desktop/Discord input preserves every message and attachment; stale desktop sync cannot erase Discord turns; delivery failure does not prevent desktop recovery; and a second transport binding is explicitly rejected until fan-out semantics exist.

### 4. Proactive notifications and operational rollout

Adapt authorized destination listing, posting budgets/reservations, incident dedupe, and notification-to-session binding. Add Discord-specific agent tools through the same preview/native tool exposure paths used by Slack. Revalidate destination access at send time and bind only successfully delivered messages. Initially deliver only to explicitly enabled guild channels; DMs and cross-team grants need a separate design.

Gate rollout by team and use a separate development application/guild. Record acknowledgement latency, queue lag, dedupe counts, authorization denials, run/delivery outcomes, rate-limit waits, Gateway reconnects, and expired decisions. Redact bot/OAuth/interaction tokens. Disable ingress and new sends to roll back; preserve records and allow active runs to settle or pause safely.

Done when repeated incident delivery is deduplicated, replies use the correct actor/session, revoked grants prevent queued sends, and process restarts recover accepted work without blindly repeating tool effects. Sending has ambiguous failure windows: reconcile recorded message IDs and use supported nonce dedupe where available; do not promise exactly-once external delivery.

## Verification plan

- Unit tests: raw-body signature checks, OAuth state expiry/replay/mismatched guild, string snowflakes, renderer boundaries, denied mentions, retry timing, and effective permission checks.
- Database/worker tests: concurrent guild claims, duplicate interactions/messages, expired leases, queue publication recovery, install-generation invalidation, and delivery retries without re-execution.
- Authorization tests: two actors sharing one owner's session; removed members; forged/cross-team/stale decisions; buttons copied to another message; revoked channel access; account-link takeover/rebinding attempts.
- Continuity tests: Discord/desktop contention, lossless transcript merge, old-client transcript PUT, failed destination lookup, and attempted Slack-plus-Discord double binding.
- Development-guild smoke tests: invite/link, `/nuphos enable|disable`, denied management by non-admins, direct mention with Message Content disabled, bare mention, mention inside an existing thread, repeated mention follow-up, ordinary follow-up with Message Content enabled, approval after a long pause, task over fifteen minutes, worker restart, rate limits, inaccessible/archived thread, and disconnect/reinstall. Verify conversation turns remain mention-based.
- Run existing Slack approval, interop, pickup, bound-chat, and transcript-guard suites whenever shared code changes. Use the runner's dependency-injection seam to avoid cross-suite module-mock interference.

This research used source inspection and official documentation, not live Discord/Slack accounts or production databases. No runtime tests were needed for this documentation-only change. Any future local MongoDB script must set `appName` to `yuanlin-m1-local-codex-<task-name>`.

## Remaining implementation decisions

The proposed defaults allow implementation to start without additional product decisions. Before phase 1, choose/pin the Gateway SDK and verify direct-mention delivery with Message Content disabled in a development guild. Before phase 2, verify Message Content eligibility in the actual Developer Portal. Before enabling desktop pickup, verify the transport-neutral transcript guard on both current and older clients. Before expanding scope, separately design DM team/session selection, forum/private threads, multi-guild teams, cross-team channel grants, and privacy-aware search. Slack Assistant Home/Chat/History and `assistant.search.context` have no assumed drop-in Discord equivalent.
