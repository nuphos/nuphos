# Codex client capabilities in Nuphos

Audit baseline: Codex CLI 0.153.4 and codex-acp 1.1.4. The desktop's installed
Codex version can differ. An app-server RPC is not automatically a model tool:
the hosting client must expose a schema, implement the handler, and route its
events. Do not import a desktop user's entire MCP configuration to fill gaps.

## Thread delegation

`nuphos-tools.create_thread` and `send_message_to_thread` operate on **Nuphos
conversation IDs**, not internal Codex thread IDs. They work through the existing
MCP surface for either agent runtime, without patching another upstream bundle.

1. Create a thread with a bounded task, completion condition, and a request to
   report back. The tool creates a visible conversation with the same owner,
   team, runtime, credential selection, and permission mode (Full Access or Auto
   Mode), then starts its first turn the same way a message typed into a new chat
   does. The source can later change any thread nested under it, whether created
   there or adopted with `set_thread_parent`, with `update_thread`: switch it
   between the two modes (Full Access requires the source itself to be in Full
   Access) or move it, with its history, to another agent picked from
   `list_agent_runtimes`, for example when it hits that agent's usage limit.
   `grant` adds credentials or local devices to the thread's selection, only
   ones the source itself has selected now, as its own `list_credentials`
   shows them. It never removes any; unticking stays with the owner.
2. Continue chatting in the source conversation while the worker runs.
3. The worker calls `send_message_to_thread` with the source ID and its result.
   The existing run claim starts an idle conversation (`status: "started"`) or
   delivers the message to an active one's turn (`status: "delivered"`).
   Agent-generated input is explicitly identified as such.

Both threads must belong to the acting user in the same team. The target runs
with its own runtime and credential selection, which the same owner chose.
Membership and ownership are checked again when the turn starts. This deliberately does not grant an agent the
human user's full workspace-wide conversation capabilities. Shared conversations
owned by another actor are not delegation sources. Existing list/read tools
remain the discovery path.

`set_thread_parent` regroups an existing thread under another conversation in
the sidebar, such as a manager session collecting the threads it coordinates;
a null parent unlinks it. It is the same operation as
`PUT /agent/conversations/:sessionId/parent`, with the same ownership and team
checks, and refuses a parent nested below the thread.

`archive_thread` archives a conversation the actor owns in the current team,
or restores it with `archived=false`. The current conversation is supported.
The tool verifies source ownership, current membership, and target ownership
and team. Archiving does not cancel an active turn; any new turn restores the
conversation: a human message, a thread message, or a bound resource or Trigger event.

The Redis trigger scheduler must be running: there is no detached-process
fallback. Queue acceptance means **queued**, not completed. A stalled job that
already persisted its input is not blindly replayed, because the task may have
performed external actions. Runs retain normal permission handling and the
existing headless deadline; neither an approval bypass nor a live runtime
session attachment is copied. Source history and per-chat model overrides are
not cloned. The new conversation uses its inherited runtime's defaults.

## Other client integration gaps

| Capability                    | Evidence / current path                                                                                                                                                         | Follow-up                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Computer Use                  | Local `codex-cua.mjs` previously imported only the `cua_repl` server. [PR #52](https://github.com/nuphos/nuphos/pull/52) addresses bundled plugin Stop/Interrupt cleanup hooks. | Track that separate fix; MCP connectivity alone is not full plugin lifecycle integration.                                                               |
| List/read threads             | `tools-sessions.ts` already exposes `list_recent_conversations` and `read_conversation` with workspace-aware access.                                                            | Reuse these instead of exposing an unscoped runtime thread inventory.                                                                                   |
| Busy-turn steering            | `codex-acp/steering.mjs` calls `turn/steer`; backend pending messages already reach active turns.                                                                               | Reused by thread delivery; no second steering implementation.                                                                                           |
| Model, effort, fast mode      | Session config persists and restores ACP settings; a pick made before the session exists is applied when it starts.                                                             | Existing integration; delegated chats start on the agent's own defaults, not a copied runtime attachment.                                               |
| Background activity           | `openab-acp-updates.ts` and `codex-async-task-wakeup.ts` track async task updates.                                                                                              | Activity tracking is not a durable condition monitor. Thread delegation adds a separate running conversation, not restart-proof CI polling.             |
| Thread fork/history branching | Upstream TUI has `fork_thread`; this bridge creates a fresh task instead.                                                                                                       | A true fork must handle transcript provenance and credentials; do not advertise create as fork.                                                         |
| In-chat timed continuation    | Codex App's scheduled tasks are client-owned; Nuphos has its own trigger scheduler.                                                                                             | A dedicated timed wakeup into an existing conversation needs explicit delivery/cancellation semantics; no `automation_update` alias is introduced here. |
| Background terminal list/stop | App-server has terminal control APIs; they are not registered as Nuphos agent tools by the ACP adapter.                                                                         | If added, scope controls to the current conversation and preserve OpenAB ownership checks.                                                              |

Upstream references for the exact baseline:

- [TUI tool definitions and execution](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/tui/src/dynamic_tools.rs)
- [Client-owned MCP transport](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/tui/src/dynamic_tools_mcp.rs)
- [App-server dynamic tools](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental)

The `codex_apps` connector namespace is distinct from the desktop's `codex_app`
and the TUI's `codex_tui` task tools. Enabling `features.apps` or the experimental
RPC capability does not register their handlers.
