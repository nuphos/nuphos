# Auto Mode — per-command authorization

Auto Mode decides, **before every `bash` (sandbox) and `local_exec` (local)
command runs**, whether it needs the user's authorization. It gives customers a
trustworthy "nothing runs without my say-so for the risky stuff" guarantee
without a human approving all 80% of commands that are script-shaped and
statically un-analyzable (see issue #314 for the data behind this).

## The three layers (see `decision.ts`)

Order is load-bearing:

1. **Catastrophic floor** (`command-analysis.ts`) — irreversible ops
   (`kubectl delete`, `terraform destroy`, `rm -rf`, `DROP/DELETE FROM`, IAM
   changes, force-push, …) **always** require authorization. Nothing — not a
   policy rule, not a session grant, not the LLM judge — can override this.
2. **Read-only fast-path** (`command-analysis.ts`) — commands that are
   confidently read-only across every segment auto-run, no LLM call. Anything
   with dynamic structure (`$()`, a pipe into an interpreter, a heredoc, a
   `bash -c` body) is never treated as read-only.
3. **LLM judge** (`judge.ts`) — the nuanced middle. Reads the full command
   (including script bodies the static layer can't see through) and the user's
   standing policy, and classifies the actual _effect_. **Fail-safe**: on
   timeout / error / unparseable output it returns null and the engine
   requires authorization.

Defaults: **read → allow, write → require auth.** Users grow a natural-language
policy (`approve … always`) to auto-allow more classes of operation.

**Auditing:** every decision is written to the tamper-evident journal
(`auth_decision` event) _and_ the durable `agent_events` trail.

## Enforcement (native AI SDK HITL, since #403)

`attachAutoModeApproval` (`approval.ts`) sets the AI SDK's `needsApproval` on
every governed tool (`bash`, `local_exec`, `port_forward_start`). A command
that needs authorization surfaces as a `tool-approval-request` stream part:
the SDK pauses the turn, the desktop renders approve/deny inline, and on
resubmit the SDK executes (approved) or denies the tool in place — no sentinel
result, no model re-issue.

The desktop's approval buttons map to:

- **Approve once** — the approval rides in the resubmitted message; nothing
  is persisted. The next command (even an identical retry) is judged fresh.
- **Approve for session** — additionally persisted per-conversation
  (`auto_mode_authorizations`). The engine exact-matches these; the judge
  receives them and clears same-effect retries/variants.
- **Always allow…** — creates an active natural-language rule in the standing
  policy (`auto_mode_policy`), matched semantically by the judge.

The judge also receives the session's already-executed governed commands
(extracted from the request transcript) as context, so it can resolve
indirection — e.g. a kubeconfig context alias created by an earlier
`get-credentials` — when matching rules that name a specific target.

## Full Access (per-conversation)

The shield-off toggle in the desktop composer disarms the gate for **one
conversation**: every governed command auto-allows, including ones whose
command text can't be read (the usual fail-safe). It is stored as a `bypass`
flag on the conversation's `auto_mode_authorizations` doc (so it expires with
the doc's 7-day TTL) and sits above every other layer — the equivalent of
Claude Code's bypass-permissions mode. Every decision is still journaled:
allows that bypass actually caused carry layer `bypass`, while read-only
commands keep the (more specific, zero-DB) `read_only_fastpath` label they
would earn anyway; toggling records `auth.bypass_enabled` /
`auth.bypass_disabled` in `agent_events`, so an auditor can bracket exactly
which spans of a conversation ran unguarded.

## HTTP API (`routes/agent.ts`)

- `GET/POST /agent/auto-mode/policy/rules`, `POST …/rules/:ruleId/activate`,
  `DELETE …/rules/:ruleId` — the standing policy (settings GUI + "Always allow").
- `POST /agent/auto-mode/session-approvals` `{sessionId, command}` — the
  "Approve for session" grant.
- `GET /agent/auto-mode/bypass?sessionId=…` / `PUT /agent/auto-mode/bypass`
  `{sessionId, bypass}` — the per-conversation Full Access flag.

## Try it locally

**1. Decision engine only (no server, no Mongo):**

```bash
cd apps/backend
bun scripts/auto-mode-demo.ts
bun scripts/auto-mode-demo.ts "kubectl scale deploy/api --replicas=5"
```

Prints the verdict + which layer decided for a corpus (and runs the real LLM
judge if Bedrock creds are configured).

**2. End-to-end against a local backend:**

Auto Mode is always on — no flag to set. Only the judge model may need pinning:

```bash
# .env
# The judge defaults to AGENT_MODEL_ID. If that is an inference profile your
# Bedrock creds cannot call (e.g. global.anthropic.*), the judge fails safe to
# "require auth". Set an accessible model explicitly:
AGENT_AUTO_MODE_JUDGE_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

Then in a chat, ask the agent to run a write command (e.g. "restart the api
deployment in staging"). It returns `⛔ Authorization required` and stops.
Approve it:

```bash
curl -sX POST "$BACKEND/agent/auto-mode/$SESSION/approve" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"command":"kubectl rollout restart deploy/api -n staging","scope":"session"}'
```

Ask the agent to try again — it now runs. Use `scope:"always"` to add a
standing rule so the judge auto-allows that class next time.

## Caveat this design is honest about

For `$()` / `| python3 <script>` / heredocs, the user (and the judge) approve
the literal command text; its exact runtime behaviour is not fully legible from
the text — the same limit Claude Code has. Auto Mode guarantees the **gate**
(nothing risky runs unapproved), not omniscient understanding.
