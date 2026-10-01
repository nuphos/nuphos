// Pure decision layer for the cache-write backfill (scripts/backfill-cache-write-tokens.ts
// is the thin, dry-run-by-default driver around it).
//
// Rows written before cache-write accounting shipped kept Anthropic's
// cache_creation_input_tokens inside `rawUsage` but had nowhere to put it in
// `tokens`, so they priced their cache writes at the plain input rate. Every
// number this module writes therefore comes from what the provider ALREADY
// reported on that row — nothing is estimated, interpolated, or spread across
// rows. A row whose rawUsage never carried the count is left exactly as it is.
//
// Deliberately NOT done here: raising what a historical row COST.
//
// providerCostUsd on a step_total row is billing-authoritative, not display
// data: usage-boundary.ts rereads these rows to rebuild partial cycle-boundary
// hours, and overage.ts settles from that. Rewriting it with the corrected
// figure would retroactively charge a team for our own under-count, on a cycle
// they have already been billed for. So the backfill touches TOKENS only, and
// the same restraint applies to the team usage pool: those hours are closed and
// re-crediting them would charge users for a bug that was ours.
//
// The corrected price still reaches every screen — withCostUsd recomputes cost
// from the token breakdown on read, so fixing the tokens is sufficient for the
// UI, the conversation summary and the reconciliation report. The delta is
// reported (backfillCostDeltaUsd) so the size of the correction is known
// without ever being applied.
import { providerCostUsd } from './model-pricing'
import { normalizeTokenUsage } from './token-usage'

import type { AgentTokenUsageKind, AgentTokenUsageRecord } from './token-usage-db'
import type { Document } from 'mongodb'

// Only the rows that carry the prompt-side breakdown. output/thinking/tool_call
// rows hold a single non-prompt count and have nothing to correct.
const PROMPT_BEARING_KINDS = new Set<AgentTokenUsageKind>(['step_total', 'turn_total', 'input'])

// The frozen cost lives on the step/turn total; the `input` projection carries
// tokens only, so backfilling it must not invent a providerCostUsd field.
const COST_BEARING_KINDS = new Set<AgentTokenUsageKind>(['step_total', 'turn_total'])

// A total row that never froze a cost falls through to usage-boundary's
// recompute-from-tokens path. Adding cacheWriteTokens would silently raise that
// recomputation, so the PRE-fix price is frozen instead: the row keeps costing
// exactly what it cost before, and settlement cannot move underneath it.
function preFixCostUsd(record: AgentTokenUsageRecord): number | undefined {
  return providerCostUsd({
    modelId: record.modelId,
    inputTokens: record.tokens.inputTokens,
    outputTokens: record.tokens.outputTokens,
    cachedInputTokens: record.tokens.cachedInputTokens,
  })
}

export type BackfillRowPatch = {
  recordId: string
  set: {
    'tokens.cacheWriteTokens': number
    providerCostUsd?: number
  }
}

export function backfillPatchForRecord(record: AgentTokenUsageRecord): BackfillRowPatch | null {
  // Already backfilled (or written by the current code): re-running the job
  // must be a no-op, not a second pass at the same row.
  if (record.tokens.cacheWriteTokens != null) return null
  if (!PROMPT_BEARING_KINDS.has(record.kind)) return null
  const cacheWriteTokens = normalizeTokenUsage(record.rawUsage).cacheWriteTokens

  if (cacheWriteTokens == null) return null

  const freezePreFixCost =
    COST_BEARING_KINDS.has(record.kind) && record.providerCostUsd == null
      ? preFixCostUsd(record)
      : undefined

  return {
    recordId: record.recordId,
    set: {
      'tokens.cacheWriteTokens': cacheWriteTokens,
      ...(freezePreFixCost != null ? { providerCostUsd: freezePreFixCost } : {}),
    },
  }
}

/** How much this row was under-billed, for the job's summary only — never
 *  written anywhere. Zero for rows that carry no prompt-side cost to compare
 *  (the `input` projection) or whose model has no known price. */
export function backfillCostDeltaUsd(
  record: AgentTokenUsageRecord,
  patch: BackfillRowPatch,
): number {
  if (!COST_BEARING_KINDS.has(record.kind)) return 0
  const before = record.providerCostUsd ?? preFixCostUsd(record)
  const after = providerCostUsd({
    modelId: record.modelId,
    inputTokens: record.tokens.inputTokens,
    outputTokens: record.tokens.outputTokens,
    cachedInputTokens: record.tokens.cachedInputTokens,
    cacheWriteTokens: patch.set['tokens.cacheWriteTokens'],
  })

  if (before == null || after == null) return 0

  return after - before
}

/** Conversations whose persisted tokenUsage summary may be stale, rediscovered
 *  from the window itself rather than from the rows a given run happened to
 *  patch.
 *
 *  This is what makes the summary repair resumable. The patch pass selects rows
 *  MISSING cacheWriteTokens; on a rerun after a crash those rows are already
 *  fixed, so a session list built while walking them comes back empty and the
 *  stale summaries are stranded with no repair path. Selecting rows that HAVE
 *  the field instead is stable across reruns: it names every conversation the
 *  correction touched, whichever run touched it, and refreshing a summary that
 *  is already correct is a harmless no-op. */
export function affectedSessionsPipeline(window: { from: Date; to: Date }): Document[] {
  return [
    {
      $match: {
        createdAt: { $gte: window.from, $lt: window.to },
        'tokens.cacheWriteTokens': { $exists: true },
      },
    },
    {
      $group: {
        _id: { sessionId: '$sessionId', userId: '$userId' },
        teamId: { $first: '$teamId' },
      },
    },
    {
      $project: {
        _id: 0,
        sessionId: '$_id.sessionId',
        userId: '$_id.userId',
        teamId: 1,
      },
    },
  ]
}
