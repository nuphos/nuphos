import type {
  MemoryAttributionEvent,
  MemoryRetentionScore,
  MemoryTurnSummary,
  TurnDistillOutcome,
} from './attribution-types'

/** Below this many observed turns an applyRate is noise, not signal — 2.4's
 * ordering treats such memories as neutral/unproven. */
export const MIN_SCORE_TURNS = 3

/** Running per-lineage aggregate so the rollup never has to hold rows —
 * only these accumulators (counts + reach id sets) stay resident. */
export type RetentionAccumulator = {
  provider: string
  teamId: string | null
  lineage: string
  turns: number
  applied: number
  considered: number
  notApplicable: number
  conversations: Set<string>
  users: Set<string>
  corrections: number
  lastAppliedAtMs: number
}

export function foldRetentionRow(
  groups: Map<string, RetentionAccumulator>,
  row: MemoryAttributionEvent,
  lineageOf: (memoryId: string) => string,
): void {
  const lineage = lineageOf(row.memoryId)
  const key = `${row.teamId ?? ''}|${lineage}`
  let g = groups.get(key)

  if (!g) {
    g = {
      provider: row.provider,
      teamId: row.teamId,
      lineage,
      turns: 0,
      applied: 0,
      considered: 0,
      notApplicable: 0,
      conversations: new Set(),
      users: new Set(),
      corrections: 0,
      lastAppliedAtMs: 0,
    }
    groups.set(key, g)
  }
  g.turns += 1
  g.conversations.add(row.conversationId)
  g.users.add(row.userId)
  if (row.tier === 'applied') {
    g.applied += 1
    // Freshness comes from the verdict-bearing signal's own timestamp, not
    // row.updatedAt — any later signal write (e.g. human feedback) advances
    // updatedAt and would inflate lastAppliedAt.
    const verdictAt = row.signals.find(
      (s) =>
        (s.signal === 'attribution_judge' || s.signal === 'human_feedback') &&
        s.verdict === 'applied',
    )?.at

    g.lastAppliedAtMs = Math.max(g.lastAppliedAtMs, (verdictAt ?? row.updatedAt).getTime())
  } else if (row.tier === 'considered') {
    g.considered += 1
  } else if (row.tier === 'not_applicable') {
    g.notApplicable += 1
  }
  if (row.signals.some((s) => s.signal === 'supersede_correction')) g.corrections += 1
}

export function finalizeRetentionScores(
  groups: Map<string, RetentionAccumulator>,
  computedAt: Date,
): MemoryRetentionScore[] {
  return [...groups.values()].map((g) => ({
    provider: g.provider,
    teamId: g.teamId,
    lineage: g.lineage,
    turns: g.turns,
    applied: g.applied,
    considered: g.considered,
    notApplicable: g.notApplicable,
    applyRate: g.applied / g.turns,
    reachConversations: g.conversations.size,
    reachUsers: g.users.size,
    corrections: g.corrections,
    lastAppliedAt: g.applied > 0 ? new Date(g.lastAppliedAtMs) : null,
    computedAt,
  }))
}

/** Pure fold: attribution rows → score docs. applyRate's denominator is every
 * turn the memory appeared in (recalled counts as an opportunity), so a
 * much-recalled never-applied memory sinks instead of hiding. */
export function computeRetentionScores(
  rows: MemoryAttributionEvent[],
  lineageOf: (memoryId: string) => string,
  computedAt: Date,
): MemoryRetentionScore[] {
  const groups = new Map<string, RetentionAccumulator>()

  for (const row of rows) foldRetentionRow(groups, row, lineageOf)

  return finalizeRetentionScores(groups, computedAt)
}

/** Pool-health fold for the scorecard route (2.3). Rates lead, counts ride
 * along; rows predating a field (e.g. distill) simply don't count toward it. */
export function computeTurnScorecard(turns: MemoryTurnSummary[]) {
  const total = turns.length
  const withRecall = turns.filter((t) => t.recalledCount > 0).length
  const withApplied = turns.filter((t) => t.appliedCount > 0).length
  const judge = {
    ran: 0,
    failed: 0,
    pending: 0,
    skippedDisabled: 0,
    skippedSampled: 0,
    skippedZeroCandidates: 0,
  }

  for (const t of turns) {
    if (t.judge === 'ran') judge.ran += 1
    else if (t.judge === 'failed') judge.failed += 1
    else if (t.judge === 'pending') judge.pending += 1
    else if (t.judge === 'skipped_zero_candidates') judge.skippedZeroCandidates += 1
    else if (t.judge === 'skipped_sampled') judge.skippedSampled += 1
    else if (t.judge === 'skipped_disabled') judge.skippedDisabled += 1
  }
  const distill: Record<TurnDistillOutcome, number> = {
    saved: 0,
    deduped: 0,
    rejected: 0,
    no_learn: 0,
    skipped_short: 0,
    skipped_volatile: 0,
    skipped_origin: 0,
    skipped_plan_approval: 0,
    skipped_disabled: 0,
    failed: 0,
  }

  for (const t of turns) {
    if (t.distill && t.distill in distill) distill[t.distill] += 1
  }

  return {
    turns: {
      total,
      withRecall,
      withApplied,
      recallRate: total ? withRecall / total : 0,
      zeroRecallRate: total ? 1 - withRecall / total : 0,
      appliedRate: total ? withApplied / total : 0,
    },
    judge: { ...judge, ranRate: total ? judge.ran / total : 0 },
    distill,
  }
}
