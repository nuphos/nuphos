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
   team, runtime, and credential selection, then persists a background job.
2. Continue chatting in the source conversation while the worker runs.
3. The worker calls `send_message_to_thread` with the source ID and its result.
   The existing run claim starts an idle conversation or enqueues a message for
   an active one. Agent-generated input is explicitly identified as such.

Both threads must belong to the acting user in the same team and retain the
same runtime and credential selection. Membership and scope are checked again
when the queued job executes. This deliberately does not grant an agent the
human user's full workspace-wide conversation capabilities. Shared conversations
owned by another actor are not delegation sources. Existing list/read tools
remain the discovery path.

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
| Model, effort, fast mode      | Session config and runtime-default modules persist and restore ACP settings.                                                                                                    | Existing integration; delegated chats use runtime defaults, not a copied runtime attachment.                                                            |
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
