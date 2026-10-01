import { providerCostUsd } from '@/lib/agent/model-pricing'
import { logError } from '@/lib/observability'

import { agentTokenUsage, cleanRecord } from './token-usage-db'
import { hasNonFiveMinuteCacheWrite, normalizeTokenUsage } from './token-usage-normalize'
import { refreshConversationTokenUsageSummary } from './token-usage-summary'

import type { AgentTokenUsageRecord, AgentTokenUsageTokens } from './token-usage-db'

export type {
  AgentTokenUsageAccounting,
  AgentTokenUsageKind,
  AgentTokenUsageProviderTotal,
  AgentTokenUsageRecord,
  AgentTokenUsageSummary,
  AgentTokenUsageTokens,
} from './token-usage-db'
export { agentTokenUsage, setupTokenUsageIndexes } from './token-usage-db'
export { hasNonFiveMinuteCacheWrite, normalizeTokenUsage } from './token-usage-normalize'

export function hasTokenUsage(tokens: AgentTokenUsageTokens): boolean {
  return Object.values(tokens).some((value) => value != null)
}

export function makeTokenUsageRecordsForModelCall(args: {
  recordPrefix: string
  sessionId: string
  userId: string
  teamId?: string
  requestId?: string
  streamId?: string
  operation: string
  source: AgentTokenUsageRecord['source']
  provider: string
  modelId: string
  region?: string
  gcpProject?: string
  stepIndex?: number
  stepNumber?: number
  finishReason?: string
  usage: unknown
  createdAt?: Date
  /** Fires when the provider reports a cache write on a TTL the price table
   *  does not model (see hasNonFiveMinuteCacheWrite). Injected rather than
   *  logged inline so this module stays free of the observability import and
   *  the branch is testable. Defaults to logging. */
  onUnexpectedCacheTtl?: (info: {
    modelId: string
    provider: string
    operation: string
    cacheWriteTokens?: number
  }) => void
}): AgentTokenUsageRecord[] {
  const tokens = normalizeTokenUsage(args.usage)

  if (!hasTokenUsage(tokens)) return []
  // Recorded either way — the tokens are real and the row must exist. What is
  // wrong is only the RATE, so this surfaces as a loud signal to update the
  // price table, never as a dropped row.
  if (hasNonFiveMinuteCacheWrite(args.usage)) {
    const report = args.onUnexpectedCacheTtl ?? reportUnexpectedCacheTtl

    report({
      modelId: args.modelId,
      provider: args.provider,
      operation: args.operation,
      cacheWriteTokens: tokens.cacheWriteTokens,
    })
  }

  const createdAt = args.createdAt ?? new Date()
  const stepProviderCostUsd = providerCostUsd({
    modelId: args.modelId,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cachedInputTokens: tokens.cachedInputTokens,
    cacheWriteTokens: tokens.cacheWriteTokens,
  })
  const base = {
    sessionId: args.sessionId,
    userId: args.userId,
    teamId: args.teamId,
    requestId: args.requestId,
    streamId: args.streamId,
    operation: args.operation,
    billing: 'background' as const,
    source: args.source,
    provider: args.provider,
    modelId: args.modelId,
    region: args.region,
    gcpProject: args.gcpProject,
    stepIndex: args.stepIndex,
    stepNumber: args.stepNumber,
    finishReason: args.finishReason,
    rawUsage: rawUsageObject(args.usage),
    createdAt,
  }

  const records: AgentTokenUsageRecord[] = [
    cleanRecord({
      ...base,
      recordId: `${args.recordPrefix}:step_total`,
      kind: 'step_total',
      accounting: 'upstream_reported',
      providerCostUsd: stepProviderCostUsd,
      tokenCount: tokens.totalTokens,
      tokens,
    }),
  ]

  if (tokens.inputTokens != null) {
    records.push(
      cleanRecord({
        ...base,
        recordId: `${args.recordPrefix}:input`,
        kind: 'input',
        accounting: 'upstream_reported',
        tokenCount: tokens.inputTokens,
        // The `input` row owns the prompt-side breakdown for every rollup that
        // sums by kind, so the cache classes must ride along with the total.
        tokens: {
          inputTokens: tokens.inputTokens,
          ...(tokens.cachedInputTokens != null
            ? { cachedInputTokens: tokens.cachedInputTokens }
            : {}),
          ...(tokens.cacheWriteTokens != null ? { cacheWriteTokens: tokens.cacheWriteTokens } : {}),
        },
      }),
    )
  }
  if (tokens.outputTokens != null) {
    records.push(
      cleanRecord({
        ...base,
        recordId: `${args.recordPrefix}:output`,
        kind: 'output',
        accounting: 'upstream_reported',
        tokenCount: tokens.outputTokens,
        tokens: { outputTokens: tokens.outputTokens },
      }),
    )
  }
  if (tokens.reasoningTokens != null) {
    records.push(
      cleanRecord({
        ...base,
        recordId: `${args.recordPrefix}:thinking`,
        kind: 'thinking',
        accounting: 'upstream_reported',
        tokenCount: tokens.reasoningTokens,
        tokens: { reasoningTokens: tokens.reasoningTokens },
      }),
    )
  }

  return records
}

function reportUnexpectedCacheTtl(info: {
  modelId: string
  provider: string
  operation: string
  cacheWriteTokens?: number
}): void {
  logError(
    'agent.token_usage.unexpected_cache_ttl',
    new Error('cache write on a TTL the price table does not model (expected 5m)'),
    info,
  )
}

export async function recordAgentTokenUsageRecords(
  records: AgentTokenUsageRecord[],
): Promise<void> {
  if (records.length === 0) return
  const cleaned = records.map(cleanRecord)

  await agentTokenUsage().bulkWrite(
    cleaned.map((record) => ({
      replaceOne: {
        filter: { recordId: record.recordId },
        replacement: record,
        upsert: true,
      },
    })),
    { ordered: false },
  )

  const first = cleaned[0]

  if (first) {
    await refreshConversationTokenUsageSummary(first.sessionId, first.userId, first.teamId)
  }
}

// Rebuild the prompt total from its parts. Returns undefined when no part was
// reported at all, so a missing count stays missing instead of becoming 0.

function rawUsageObject(usage: unknown): Record<string, unknown> | undefined {
  if (!usage || typeof usage !== 'object') return undefined

  return Object.fromEntries(
    Object.entries(usage as Record<string, unknown>).filter(([, value]) => value !== undefined),
  )
}
