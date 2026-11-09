import { providerCostUsd } from './model-pricing'
import { agentTokenUsage } from './token-usage-db'
import { KIND_TOKEN_SUMS } from './usage-aggregation'

import type { UsageTokenRow } from './usage-aggregation'
import type { Document } from 'mongodb'

/** The window the Trigger page shows next to a schedule. */
const DEFAULT_DAYS = 7

export type TriggerUsageTotal = {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  /** Undefined when no recorded model has a known price. */
  costUsd?: number
  /** Turns that reported usage. */
  turns: number
  lastRecordedAt?: string
}

export type TriggerUsage = {
  since: string
  totals: TriggerUsageTotal
  /**
   * Per conversation, most expensive first. A Trigger-created conversation is
   * one fire; a bound conversation accumulates every fire it was woken by.
   */
  sessions: (TriggerUsageTotal & { sessionId: string })[]
}

type UsageRow = UsageTokenRow & { sessionId: string; turns: number; lastRecordedAt: Date }

type Accumulator = { total: TriggerUsageTotal; cost: number; priced: boolean }

export function triggerUsagePipeline(match: Document): Document[] {
  return [
    { $match: match },
    {
      $group: {
        _id: { sessionId: '$sessionId', provider: '$provider', modelId: '$modelId' },
        turns: { $sum: { $cond: [{ $eq: ['$kind', 'step_total'] }, 1, 0] } },
        lastRecordedAt: { $max: '$createdAt' },
        ...KIND_TOKEN_SUMS,
      },
    },
    {
      $project: {
        _id: 0,
        sessionId: '$_id.sessionId',
        provider: '$_id.provider',
        modelId: '$_id.modelId',
        turns: 1,
        lastRecordedAt: 1,
        inputTokens: 1,
        cachedInputTokens: 1,
        cacheWriteTokens: 1,
        outputTokens: 1,
        totalTokens: 1,
      },
    },
  ]
}

function emptyTotal(): TriggerUsageTotal {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    turns: 0,
  }
}

function accumulate(acc: Accumulator, row: UsageRow): void {
  const total = acc.total

  total.inputTokens += row.inputTokens
  total.cachedInputTokens += row.cachedInputTokens
  total.cacheWriteTokens += row.cacheWriteTokens
  total.outputTokens += row.outputTokens
  total.totalTokens += row.totalTokens
  total.turns += row.turns
  const recordedAt = row.lastRecordedAt.toISOString()

  if (!total.lastRecordedAt || recordedAt > total.lastRecordedAt) total.lastRecordedAt = recordedAt
  const cost = providerCostUsd(row)

  if (cost != null) {
    acc.priced = true
    acc.cost += cost
  }
}

function finish(acc: Accumulator): TriggerUsageTotal {
  return { ...acc.total, ...(acc.priced ? { costUsd: acc.cost } : {}) }
}

/**
 * What a Trigger's fires spent over the last `days`, totalled and split by
 * conversation. Only turns the runtime reported usage for are counted; a
 * runtime that reports nothing contributes nothing.
 */
export async function getTriggerUsage(
  triggerId: string,
  teamId: string | undefined,
  days = DEFAULT_DAYS,
  now: Date = new Date(),
): Promise<TriggerUsage> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const rows = await agentTokenUsage()
    .aggregate<UsageRow>(
      triggerUsagePipeline({
        triggerId,
        ...(teamId ? { teamId } : {}),
        createdAt: { $gte: since },
      }),
    )
    .toArray()
  const totals: Accumulator = { total: emptyTotal(), cost: 0, priced: false }
  const sessions = new Map<string, Accumulator>()

  for (const row of rows) {
    accumulate(totals, row)
    const session = sessions.get(row.sessionId) ?? {
      total: emptyTotal(),
      cost: 0,
      priced: false,
    }

    accumulate(session, row)
    sessions.set(row.sessionId, session)
  }

  return {
    since: since.toISOString(),
    totals: finish(totals),
    sessions: [...sessions.entries()]
      .map(([sessionId, acc]) => ({ sessionId, ...finish(acc) }))
      .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.totalTokens - a.totalTokens),
  }
}
