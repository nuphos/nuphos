# Runtime session authority

OpenAB schemaVersion 2 owns the agent session lifecycle, including work in its
gateway. The backend routes authenticated commands and preserves transcripts;
the UI renders received snapshots and their action capabilities. Neither stream
leases, historical tool cards nor connection flags can turn a session busy/idle.
Transport copies may carry immutable observations for delivery/replay; replay
must never renew their freshness or overwrite a newer runtime revision.

| Runtime situation                                 | UI projection                                         |
| ------------------------------------------------- | ----------------------------------------------------- |
| Native session creation/load                      | Loading the session                                   |
| Provider executing                                | Thinking, responding, running tools or working        |
| Human/permission/device request                   | Runtime-provided request label and pending requests   |
| Provider idle, gateway prompt outstanding         | Finishing the request                                 |
| Idle foreground with unfinished background work   | Background tools, with Send available                 |
| Background task completion queued/running         | Pending automatic continuation / continuing           |
| Automatic continuation lacks an output connection | Automatic continuation paused: output connection lost |
| Runtime cancellation awaiting native completion   | Stopping, with another cancellation disabled          |
| Configuration operation                           | Reading or updating session settings                  |
| Native failure, interruption, output/turn limit   | Runtime outcome and reason                            |
| New provider state/active flags                   | Preserved provider state/flags                        |
| Missing or stale observation                      | Connection lost; no inferred execution status         |

## Migration

1. Provision a separate `OPENAB_ACP_CONTROL_KEY` in each runtime Secret and
   deployment. The backend uses this operator credential for control queries and
   decisions; ordinary ACP credentials cannot read inventory or mutate decisions.
   Managed credentials are derived from the backend master secret with separate
   domain, team and runtime scope. Keep the ordinary ACP key for older clients.
   Custom runtimes must provision both fields in their Nuphos runtime Secret;
   the chat credential field must retain the ordinary ACP key. Development
   backends use `NUPHOS_CLAUDE_CONTROL_KEY` / `NUPHOS_CODEX_CONTROL_KEY` to match
   each runtime's operator key. Chat and control connections use separate pools. Deploy the new OpenAB unified images for both providers first. Existing clients
   remain responsible for their old continuation policy until opting in.
2. Drain or explicitly cancel old backend-owned decision waits before replacing
   that backend. New pending waits and their decisions live in runtime memory.
3. Deploy the backend requiring v2 and opting in to runtime continuation ownership.
4. Deploy Desktop rendering v2. A runtime restart invalidates its outstanding
   requests; the application never answers a replacement runtime from a cache.

The new client does not auto-resume on stream EOF, count unfinished transcript
tools to infer busy, synthesize a stop from a local timeout, or auto-submit a
locally queued follow-up. Pre-existing local follow-ups remain **Unsent drafts**
and can be sent explicitly when the runtime allows it. Runtime `actions.steer`
is currently false; do not expose a backend-owned queue as a runtime capability.

Conversation placement, transcripts, user drafts, credentials and transport
cursors remain application data. `runtimeState` is an observed rendering value,
not an independently writable/persisted execution state. Status queries never
load, resume or claim a session output route. Automatic continuation can remain
paused if the runtime has no output connection; Stop cancels that pending
continuation and a subsequent user command can attach a new transport.

## Verification

Exercise permission approval, cancellation during initialization, native idle
before gateway completion, tools completing in the background, automatic
continuation, stale/replayed snapshots and runtime replacement. Compare the UI
label/actions to `_openab/session/state`; an open SSE response alone must not
block sending. Deployment drain decisions query runtime inventory and defer on
an unreachable runtime instead of treating it as idle.
