import { providerCostUsd } from '@/lib/agent/model-pricing'

import type { UsageTokenRow } from '@/lib/agent/usage-aggregation'

// One (bucket × provider × model) group straight out of Mongo. `key` is the
// bucket the caller grouped by: team id, user id, or session id.
export type KeyedUsageTokenRow = UsageTokenRow & { key: string }

export type FinopsTotals = {
  costUsd: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  // True when at least one model in the bucket has no entry in the pricing
  // table, so `costUsd` is a floor rather than the whole bill.
  hasUnpricedModel: boolean
}

export type FinopsRow = FinopsTotals & { key: string }

function emptyTotals(): FinopsTotals {
  return {
    costUsd: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hasUnpricedModel: false,
  }
}

// Pricing happens per (provider, model) group, never on a pre-summed bucket:
// the rates differ per model, and providerCostUsd needs the uncached-input
// split of that one model to charge cache reads at the cache rate.
function addRow(totals: FinopsTotals, row: UsageTokenRow): void {
  const cost = providerCostUsd(row)

  if (cost == null) totals.hasUnpricedModel = true
  else totals.costUsd += cost
  totals.inputTokens += row.inputTokens
  totals.cachedInputTokens += row.cachedInputTokens
  totals.cacheWriteTokens += row.cacheWriteTokens
  totals.outputTokens += row.outputTokens
  totals.totalTokens += row.totalTokens
}

/** Fold per-model groups into one priced total per bucket, most expensive first. */
export function foldByKey(rows: readonly KeyedUsageTokenRow[]): FinopsRow[] {
  const byKey = new Map<string, FinopsRow>()

  for (const row of rows) {
    let bucket = byKey.get(row.key)

    if (!bucket) {
      bucket = { key: row.key, ...emptyTotals() }
      byKey.set(row.key, bucket)
    }
    addRow(bucket, row)
  }

  return Array.from(byKey.values()).sort((a, b) => b.costUsd - a.costUsd)
}

/** Fold every group into a single priced total (the MTD headline numbers). */
export function foldTotals(rows: readonly UsageTokenRow[]): FinopsTotals {
  const totals = emptyTotals()

  for (const row of rows) addRow(totals, row)

  return totals
}
