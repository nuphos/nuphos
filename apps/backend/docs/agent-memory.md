# Agent Memory — architecture & decision record

In-house agent memory, replacing the xtrace SaaS (PR #463, superseding the
closed PR #441; architecture updated 2026-07-17). This document describes the
target architecture in that change, not its deployment status. Two layers —
team knowledge (Genes) and personal records — are written through a single
`save_memory` tool with a `scope` parameter. Both scopes publish immediately
(default-enabled); control is post-hoc removal in the Memories view. No
vectors, no automatic writes.

## Before → after

xtrace was a one-way funnel: every turn distilled unreviewed, no update path,
usage unknowable. The native design writes only on an explicit model decision
after a verified resolution, publishes default-enabled with post-hoc control
(inspect/remove in the Memories view), and reads leave fetch records.

```text
BEFORE — xtrace SaaS                      AFTER — native (this PR)

every completed turn (value or not)       turn where a problem was actually
       │                                  resolved AND verified
       ▼                                         │
ingestChatTurn ── 2 plain-text strings           ▼
       │          auto-write, no review   save_memory(scope: "team") ── checks
       ▼                                         │   index first; secret gate
┌──────────────────────────────┐                 │   fails closed; idempotency
│ xtrace SaaS (black box)      │                 │   key; EDITOR+ only
│ merge/dedupe: NEVER fired    │                 ▼
│ (484/484 created)            │          publishes immediately → Gene
│ 38% of turns yield nothing   │          (default-enabled; teammates can
└──────────────────────────────┘          inspect/remove in Memories view)
       │                                         │   lineageId / revision /
       ▼  next turn                              │   evidence pointers
retrieve (10s budget, 4 pools)                   ▼
       │                                  agent_team_memories (own Mongo,
       ▼                                  team-isolated, versioned)
4–8 memories injected into prompt                │
(raw scope strings leak)                         ▼  next turn (any team conv)
       │                                  bounded one-line Team Index
       ▼                                         │
       ✕  dead end:                              ▼
   no feedback / outcome / update API     memory_get (detail on demand)
   correction = delete only                      │
   usage unknowable                              ▼
   → no self-improvement,                 memory_get fetch records →
     only monotonic accumulation          usage telemetry (keep/kill signal)
                                                 │
                                                 ▼
                                          ↻ loop-closure (post-dogfood):
                                            confirmed-reuse / needs_review /
                                            revision — keep/kill computable

                                          + personal layer (also new):
                                          save_memory(scope: "personal") →
                                          owner-scoped record → Saved-memories
                                          index → memory_get. Zero automatic
                                          writes.
```

## Architecture

```text
                        agent turn (routes/agent.ts)
                                   │
   ┌───────────────────────────────┼──────────────────────────────┐
   │ context injection             │ tools (tools-skilled.ts)     │
   │                               │                              │
   │ renderMemoryContext()         │ save_memory(scope:           │
   │  · injection (default):       │   personal|team, text|gene)  │
   │    up to 50 active Genes +    │                              │
   │    50 personal pointers       │ memory_get(id | query)       │
   │  · summary: pool counts only  │                              │
   │  · automatic: latest user     │                              │
   │    query → full-pool lexical  │                              │
   │    recall → up to 5 pointers  │                              │
   │  · team flat records are      │                              │
   │    count-only in injection,   │                              │
   │    but automatic/search reach │                              │
   │    them                       │                              │
   │  · injected AFTER the second  │                              │
   │    cachePoint → index churn   │ exactly two tools (ADR-0004);│
   │    never invalidates the      │ scope is a parameter, never  │
   │    cached prompt prefix above │ a per-scope tool variant     │
   └───────────────┬───────────────┴───────────────┬──────────────┘
                   │        team-memory/ module    │
                   ▼                               ▼
        store.ts (all reads/writes)      records-api.ts (wire DTOs for
        secret gate fails closed         /agent/memories*, xtrace-parity)
                   │
     MongoDB ──────┼──────────────────────────────────────────────
       agent_team_memories            Genes: title, triggerSignals,
                                      investigationPath, traps,
                                      doNotUseWhen; lineageId; status
                                      active|needs_review|rejected|superseded
       agent_team_memory_proposals    audit + idempotency envelope; immediate
                                      publish, NOT an approval gate
       agent_team_memory_applications reserved outcome journal (considered/
                                      applied/not_applicable); no runtime
                                      caller yet
       agent_memories                 personal flat records: scope, owner,
                                      (user,team) pool semantics, source
                                      save_memory|imported
```

- **Team layer (Genes)**: reusable investigation knowledge. A **Gene** is
  the strategy — problem-class knowledge stated so it transfers: title,
  trigger signals (what a first report of the problem contains),
  investigation path (action → check steps), traps, do-not-use-when. A
  **Capsule** is one verified execution of that strategy — the concrete
  case: problem, root cause, actions taken, how it was verified, and the
  conversation it happened in. Every Gene is born with the capsule of the
  case that produced it and accumulates one more per confirmed reuse;
  capsules are embedded in the Gene document (single-document atomicity)
  and their problem/root-cause text joins keyword search, so a Gene is
  findable by concrete symptoms, not just its abstract title. A Gene
  without capsules is a claim; capsules are the evidence — and evidence is
  append-only: there is deliberately NO per-capsule edit/remove surface
  (that would allow doctoring the record). Capsules must stay reviewable
  (auditable: author, source conversation, tool calls, observedAt;
  inspectable: ADR-0007 item 6); disposition happens at Gene granularity
  (needs_review / remove), never by trimming individual evidence. Written via
  `save_memory(scope: "team")` (EDITOR+, user-origin turns only). The write
  records a proposal→published pair in one step — audit trail and idempotency
  survive, but there is no confirmation pause: memories are default-enabled
  (ADR-0005) and any teammate can inspect or soft-delete them in the Memories
  view. Reads: a bounded pointer index (title + trigger signals) goes into
  context; the agent loads full Genes on demand with `memory_get`.
- **Personal layer**: Claude Code model — every write is an explicit
  `save_memory(scope: "personal")` tool call, made when the user asks or when
  the model itself judges something worth keeping; there is NO pipeline that
  writes without a model decision (that is what "no automatic writes" means).
  The owner is their own reviewer. Pool semantics match xtrace: (user, team)
  pools are distinct from the solo pool.
- **Retrieval**: three delivery modes share the same access-controlled native
  pools and `memory_get`, but differ in what is preloaded. The default
  `injection` mode uses a deterministic, bounded index-in-context + model
  judgment for the visible set, plus keyword search for the long tail. "50 per
  pool" means
  two independent caps: up to 50 live personal records in the current
  `(user, team)` pool, and up to 50 active Team Genes for the current team.
  Team-scope flat records (legacy imports and shared facts) are never rendered
  per-entry; the prompt receives only their count so the model knows to search.
  Access and lifecycle filters run first (owner/team/scope, not tombstoned;
  Genes must be active), but the default index has **no current-query relevance
  filter**: each visible pool is sorted by `updatedAt DESC` and then capped.
  Reads update `lastFetchedAt`/`fetchCount`, not `updatedAt`, so default
  "recent" means recently written or changed, not recently used.

  ```text
  personal: owner + team + live ─ updatedAt DESC ─ top 50 ──┐
  Genes: team + active ────────── updatedAt DESC ─ top 50 ──┼─ prompt index
  team flat records: team + live ───── count only ──────────┘

  injection/summary ─ model calls memory_get(query) ─ full readable pool

  automatic ─ latest user message ─ Mongo $text ─ optional rerank ─ top 5 pointers
                                                               └─ memory_get(id)
  ```

  In `injection` and `summary`, query relevance starts only when the model
  calls `memory_get(query)`. In `automatic`, the backend runs that relevance
  step from the latest user message before the model call, interleaves the
  record and Gene lexical rankings (their Mongo scores are collection-local),
  optionally reranks the combined candidates when `MEMORY_RERANK_ENABLED` is
  on, and attaches at most five compact pointers to the latest user message.
  It never injects full memory bodies automatically; the model still calls
  `memory_get(id)` before relying on a match, preserving fetch provenance.

  The Mongo text indexes weight authored title/keywords above body text and
  include CJK shadow tokens; Gene search covers title, trigger signals, and
  capsule problem/root-cause evidence. This is the ADR-0008 rung-1 escape
  hatch: at import the heaviest user has 482 personal memories (11 users
  exceed the 50-entry index), so top-50 alone would strand the tail. No
  embeddings, no vector store — an operational choice, not an engine limit:
  Community 8.2 ships vector search only as a preview that requires running
  the separate `mongot` search process, which our bare `mongod` replica sets
  deliberately don't operate. `$text` is the no-vector recall rung; ADR-0008
  rung 4 owns any evidence-gated escalation.

  The cap and deterministic default are deliberate: they bound prompt size
  and avoid returning to xtrace's query-dependent system block, which changed
  every turn and invalidated the prompt cache below it. Delivery is now an
  A/B/C switch: `injection` (default), `summary` (counts only), or `automatic`
  (native query-aware top-five pointers attached at the latest user-message
  tail, after cached history). Separately, `MEMORY_INDEX_RANKING=decay` scores
  the whole visible injection pool by the newest of write/fetch/verification
  time, log-damped by fetch count, before taking 50. Decay is usage-aware but
  still not current-query-aware, and it reorders rather than archives records.
  Defaults remain `injection` + `recency`.

- **Frontend**: the existing Memories surface and `/agent/memories*` DTO shape
  remain compatible, but the frontend is not unchanged. The desktop adds
  scope-aware Personal/Team presentation, consumes the SSE save-chip and
  `memory-provenance` frames, and lets users inspect or soft-delete recalled
  and fetched memories directly from the answer provenance UI.
- **Trust wording**: injected indexes are labeled background context, not
  instructions — the model is told to verify before acting on them.

## Security

- Writes fail closed on secret-bearing content (high-entropy, assignments,
  URL credentials) — justified empirically: 17/484 xtrace memories in prod
  carried secrets verbatim.
- Roles: EDITOR+ may write team memory, VIEWER is read-only, trigger-origin
  turns may never write team memory.
- ALL deletes are soft: genes tombstone to `rejected` (lineage preserved,
  gated EDITOR+); flat records tombstone with who/when provenance
  (ADR-0005/0006) — audit survives, restore stays possible, and an identical
  later save cannot silently resurrect removed content.

## Decision record

| #   | Decision                                                                                 | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Replace xtrace entirely, both layers survive                                             | xtrace's only self-improvement (ingest-time merge/dedup) never fired once in prod (484/484 created); SDK has no feedback/update API (delete only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | ~~Human publish gate on team memory~~ **Superseded by #10**                              | Original rationale: team knowledge is load-bearing; bad Genes mislead every teammate. Prior-art search (2026-07-13): no shipped system has this loop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | **No automatic writes** (removed plan auto-ingest too)                                   | 38% of xtrace auto-ingests produced nothing; auto-distillation deferred until dogfood data argues for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | No vectors                                                                               | No $vectorSearch on self-hosted community Mongo; bounded pointer index + model judgment suffices at our scale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | No feature flag; the PR is the cutover boundary                                          | Memory is a core feature. Rollback = `git revert -m 1` of the merge commit (drill-verified — hence: **merge with a merge commit, never squash**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | Gene `lineageId` + applications journal (`recordApplication`)                            | Revision identity from day one. The keep/kill signal in practice is `fetchCount`/`lastFetchedAt` + the `memory.retrieved`/`memory.searched` events + the provenance frame; `recordApplication` exists but has no production caller yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | Migration = full org export + Braintrust gap snapshots                                   | The early batch (614: 411 team + 203 personal, 16 redacted) came from Braintrust snapshots while the export key was unobtainable; the export adapter (ZEA-10186) then ran the full history. **Prod-verified 2026-07-16: 2,601 imported records live in `atlas.agent_memories`** (2,185 personal / 416 team; 177 tombstoned by deletion reconciliation; createdAt spans 2026-05-21 → 2026-07-15 08:32). All flagged (`imported` category, `importedId` idempotency) and inert until this code deploys. Remaining at cutover: ONE final gap top-up — xtrace keeps ingesting until the deploy moment (runbook step 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 8   | Memory indexes injected after the second cachePoint                                      | Index churn must not invalidate the cached prompt prefix _above_; verified in dogfood (follow-up turn: 33k cache-read / 55 cache-write tokens). A churn still re-writes the history cache _below_ once — see § Cache economics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 9   | EDITOR+ self-confirm publish (no second reviewer)                                        | Matches team size; revisit if teams grow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11  | **Write-time correctness gate** (2026-07-15, ADR-0006)                                   | Flat-record removal is a tombstone, never a delete; identical (normalized) re-save of a live record is idempotent and of a tombstoned one is refused; `supersedes` on `save_memory` replaces an outdated memory in place of an edit tool. Importer identity stays `importedId` (a tombstoned import cannot be re-imported).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 10  | **Two-tool surface + default-publish** (2026-07-15, ADR-0004/0005)                       | `save_memory(scope)` + `memory_get` replace the five-tool surface; scope is a parameter, never a per-scope tool variant. Team saves publish immediately (default-enabled) — control moves from a pre-publish confirmation pause to post-hoc visibility + soft-delete in the Memories view. Removes `team_memory_publish` (a tool whose description begged "never call on your own initiative" — an injection surface) and `team_memory_mark` (usage telemetry falls back to `memory_get` fetch records; revisit if the keep/kill signal starves). The proposal→published pair is still recorded per write for audit + idempotency.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 12  | **Export `group_ids` honored + prod scope reconciliation** (2026-07-16, cutover-todo C1) | The 2026-07-14 export's `metadata.group_ids` semantics were initially dropped by the importer, misfiling team-shared records as `personal`. Measured 2026-07-16: 785 grouped team-context records (each carries exactly ONE group id; 12 teams, strict 1:1 team→group mapping) + 5 `:shared` owners = 790 team-shared under the old runtime `scopesForMemory` semantics — the rule "team-context owner + non-empty `group_ids` ⇒ team scope" reproduces those semantics exactly on this corpus. Resolution: the importer now honors `group_ids`, and `scripts/reconcile-imported-team-scope.ts` flips the prod rows already misfiled as `personal` (dry-run prints per-class counts: already-team / personal-live / personal-tombstoned / missing). **Prod-verified 2026-07-16: `--apply` flipped 486/486 misfiled rows** (302 were already team via the Braintrust batch + `:shared` owners; 2 missing = the secret-redaction import skips; convergence re-run: 788 already-team / 0 to flip). Runbook step 4 re-runs it after the deploy-day gap top-up as a no-op check. |

Known gap: ~~xtrace's opt-in app-global pool is not covered by the
snapshots~~ closed — the full org export
(`org-conversation-memory-export-2026-07-14`, 2,437 memories incl.
app-global/team-shared/solo pools) got its `export.json` adapter (ZEA-10186)
and the full-history import HAS RUN against prod (2026-07-16 inventory:
2,601 rows — see decision #7). App-global (3) stays unimported by decision
(no native home yet); 10 records were skipped because their secret-bearing
content did not converge under redaction.

## Cache economics

Bedrock prompt caching is a strict prefix match: a byte change at position N
re-writes everything after N (1.25x) on the next request; unchanged prefixes
read at ~0.1x. Three placements matter for memory:

| Placement                                                      | Cost when memory changes                                                                                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System segment, before CP#2 (old xtrace block)                 | Re-writes the rest of the system segment **and the entire history** — and the xtrace block changed _every turn_ (query-keyed recall)                                             |
| System segment, after CP#2 (**current**: deterministic index)  | Prefix above survives; history below re-writes **once per churn** (save_memory / publish / supersede) — rare, bounded                                                            |
| Latest user-message tail (**automatic** mode)                  | Query-dependent pointers sit after cached history; only the current-turn delta processes. If that user message is absent/summarized, the request falls back to system placement. |
| Behind the history (inject into latest user message on change) | Nothing re-writes; old index copies stay in history at ~0.1x read                                                                                                                |

Prod measurements (`agent_token_usage.rawUsage.inputTokenDetails`, 2026-07):

- Post-#408 moving checkpoint: in-loop steps read ~65k / **30 tokens**
  uncached — history caching works.
- Turn-first steps on the old xtrace design averaged **27.5k cache-write**
  (the every-turn volatile block dragging the whole history). The
  deterministic index eliminates the _per-turn_ component; the residual
  turn-boundary write comes from cache TTL expiry and the remaining volatile
  system messages (`activePlanStatusMessage`, `autoModeMessage`, hourly
  `currentTime` rollover).
- Escalation trigger: if churn frequency x conversation length makes the
  once-per-churn history re-write visible in the numbers above, move to the
  third placement.

Audit query (readonly, `.env` MONGODB_URI): group `kind: "step_total"`
records by `stepIndex == 0`, averaging
`rawUsage.inputTokenDetails.{cacheReadTokens,cacheWriteTokens,noCacheTokens}`.
The cache-smoke phase-3 variant on the `can/memory-research-scripts` branch
proves the invalidation semantics against real Bedrock.

## Operations

All operator-run tooling lives on the `can/memory-research-scripts` branch
(local), not in the shipped tree: the xtrace import/export-scope/reconcile
scripts, the two post-deploy metadata backfills, the legacy → gene
distillation pipeline (spec: `docs/memory-legacy-distillation-spec.md` on
that branch) with its review page, the offline eval, the end-to-end smoke,
and the dataset/dogfood notes. The **post-merge cutover runbook** was
extracted to `docs/memory-cutover-runbook.md` on the same branch — prod
Mongo writes happen only through its explicitly latched steps.

Follow-on tracks: ADR-0007 frontend surfaces AND the ADR-0008 recall series
(tracks A/B, rung 0.5, C3 eval, built-ahead flags) both shipped INSIDE this
PR after all — the "never inside it" plan was superseded 2026-07-15/16.
Still ahead: the two post-deploy metadata backfills
(`backfill-memory-search-text.ts`, `backfill-memory-titles.ts`, ops branch), the
ADR-0003 delivery-mode A/B/C (its track-A gate is satisfied by this PR), and
ADR-0008 flag enablement (`MEMORY_RERANK_ENABLED`, `MEMORY_INDEX_RANKING`)
once the baseline is in.
