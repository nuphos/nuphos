// Pure decision layer for correcting resumed Claude turns
// (scripts/backfill-resumed-turn-usage.ts is the dry-run-by-default driver).
//
// Until #5205, the first turn after a Claude Code session resumed was recorded
// with the running total Claude Code restores from its transcript, not with the
// turn's own usage (#5203). Every model the session had used came back in that
// result, so all of a resumed result's rows carry a running total.
//
// The running total is a chain: each restored reading is the previous one plus
// every turn since. So a restored row's own usage is its reading minus the
// previous restored reading of that model minus the turns recorded in between.
// The chain does restart (a fresh Claude session, a compaction), and its first
// reading has nothing to subtract from; those rows are estimated from the
// session's ordinary turns of that model and say so. Anything that does not fit
// is left as it is and reported for a person to look at.
import { withTransaction } from '@/lib/db'

import { agentTokenUsage } from './token-usage-db'

import type { AgentTokenUsageTokens } from './token-usage-db'

export const CORRECTED_FIELDS = [
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteTokens',
  'outputTokens',
] as const

export type CorrectedField = (typeof CORRECTED_FIELDS)[number]
export type Counts = Record<CorrectedField, number>

// A step_total row of one session. `original` is set on a row this backfill
// already corrected, so a rerun reads the chain as it was recorded.
export type ResumedUsageRow = {
  recordId: string
  modelId: string
  createdAt: Date
  tokens: AgentTokenUsageTokens
  original?: Counts
}

export type ResumedUsageDecision = {
  recordId: string
  modelId: string
  createdAt: Date
  before: Counts
} & (
  | { action: 'correct'; method: 'chain_diff' | 'chain_start_estimate'; after: Counts }
  | { action: 'manual'; reason: string; suggested?: Counts }
  | { action: 'already_corrected' }
)

// A reading this far above the session's usual turn of that model can only be
// a restored total.
const MIN_RESTORED_INPUT = 10_000_000
const RESTORED_RATIO = 20

function counts(tokens: AgentTokenUsageTokens): Counts {
  return Object.fromEntries(CORRECTED_FIELDS.map((f) => [f, tokens[f] ?? 0])) as Counts
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)

  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function looksRestored(input: number, typical: number): boolean {
  return input > MIN_RESTORED_INPUT && input > RESTORED_RATIO * Math.max(typical, 1)
}

/** Decides every restored row of one session; `rows` are its step_total rows. */
export function resumedTurnDecisions(rows: ResumedUsageRow[]): ResumedUsageDecision[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const recorded = sorted.map((row) => ({ row, value: row.original ?? counts(row.tokens) }))
  const byModel = new Map<string, typeof recorded>()

  for (const entry of recorded) {
    byModel.set(entry.row.modelId, [...(byModel.get(entry.row.modelId) ?? []), entry])
  }
  const typical = new Map(
    [...byModel].map(([model, list]) => [model, median(list.map((e) => e.value.inputTokens))]),
  )
  // One restored row marks its whole result (same createdAt) as restored.
  const restoredAt = new Set(
    recorded
      .filter((e) => looksRestored(e.value.inputTokens, typical.get(e.row.modelId) ?? 0))
      .map((e) => e.row.createdAt.getTime()),
  )
  const decisions: ResumedUsageDecision[] = []

  for (const [model, list] of byModel) {
    const ordinary = list.filter((e) => !restoredAt.has(e.row.createdAt.getTime()))
    const estimate = Object.fromEntries(
      CORRECTED_FIELDS.map((f) => [f, median(ordinary.map((e) => e.value[f]))]),
    ) as Counts
    let previous: Counts | undefined
    let between = counts({})

    for (const { row, value } of list) {
      if (!restoredAt.has(row.createdAt.getTime())) {
        for (const f of CORRECTED_FIELDS) between[f] += value[f]
        continue
      }
      const base = {
        recordId: row.recordId,
        modelId: model,
        createdAt: row.createdAt,
        before: value,
      }
      const last = previous
      const continues = last && CORRECTED_FIELDS.every((f) => value[f] >= last[f])

      if (row.original) decisions.push({ ...base, action: 'already_corrected' })
      else if (last && continues) {
        const diff = Object.fromEntries(
          CORRECTED_FIELDS.map((f) => [f, value[f] - last[f] - between[f]]),
        ) as Counts

        if (CORRECTED_FIELDS.some((f) => diff[f] < 0)) {
          decisions.push({
            ...base,
            action: 'manual',
            reason:
              'negative: the reading grew less than the turns recorded since the previous one',
          })
        } else if (looksRestored(diff.inputTokens, typical.get(model) ?? 0)) {
          decisions.push({
            ...base,
            action: 'manual',
            reason: "still_large: the corrected turn is still far above this session's usual turn",
            suggested: diff,
          })
        } else decisions.push({ ...base, action: 'correct', method: 'chain_diff', after: diff })
      } else if (ordinary.length === 0) {
        decisions.push({
          ...base,
          action: 'manual',
          reason:
            'no_ordinary_turns: the chain starts here and there is no usual turn to estimate from',
        })
      } else
        decisions.push({
          ...base,
          action: 'correct',
          method: 'chain_start_estimate',
          // A running total already covers this turn, so it caps the estimate.
          after: Object.fromEntries(
            CORRECTED_FIELDS.map((f) => [f, Math.min(value[f], estimate[f])]),
          ) as Counts,
        })
      previous = value
      between = counts({})
    }
  }

  return decisions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

export const RESUMED_TURN_ROWS = {
  operation: 'agent.turn',
  accounting: 'upstream_reported',
  provider: 'claude-code',
} as const

/**
 * Writes one session's corrections in one transaction and one bulk write (a
 * busy session has hundreds, and a transaction must finish within a minute):
 * the step_total row and the same turn's input and output rows. Only tokens
 * change; the recorded ones go to `resumedUsageCorrection.original`, and a row
 * that has it is skipped.
 */
export async function applyResumedTurnCorrections(
  sessionId: string,
  decisions: ResumedUsageDecision[],
): Promise<void> {
  const untouched = { resumedUsageCorrection: { $exists: false } }
  const updates = decisions.flatMap((d) => {
    if (d.action !== 'correct') return []
    const marker = { resumedUsageCorrection: { original: d.before, method: d.method } }
    const turn = { ...RESUMED_TURN_ROWS, sessionId, modelId: d.modelId, createdAt: d.createdAt }
    const { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens } = d.after
    const input = {
      'tokens.inputTokens': inputTokens,
      'tokens.cachedInputTokens': cachedInputTokens,
      'tokens.cacheWriteTokens': cacheWriteTokens,
    }
    const output = { 'tokens.outputTokens': outputTokens }
    const total = { 'tokens.totalTokens': inputTokens + outputTokens }

    return [
      { filter: { recordId: d.recordId }, $set: { ...marker, ...input, ...output, ...total } },
      { filter: { ...turn, kind: 'input' as const }, $set: { ...marker, ...input } },
      { filter: { ...turn, kind: 'output' as const }, $set: { ...marker, ...output } },
    ].map(({ filter, $set }) => ({
      updateMany: { filter: { ...filter, ...untouched }, update: { $set } },
    }))
  })

  if (updates.length === 0) return
  await withTransaction(async (session) => {
    await agentTokenUsage().bulkWrite(updates, { session })
  })
}
