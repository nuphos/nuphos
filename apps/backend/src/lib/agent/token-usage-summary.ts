import { agentConversations } from '@/lib/agent/db'

import { agentTokenUsage, cleanRecord } from './token-usage-db'

import type { AgentTokenUsageSummary } from './token-usage-db'
import type { Document } from 'mongodb'

// A single model call writes several rows (step_total + input + output +
// thinking) that repeat each other's numbers, so every token class is summed
// only from the ONE row kind that owns it, or the conversation totals double
// count. Cache reads and cache writes both live on the `input` row alongside
// the prompt total they are carved out of.
const KIND_FOR_TOKEN_FIELD = {
  inputTokens: 'input',
  cachedInputTokens: 'input',
  cacheWriteTokens: 'input',
  outputTokens: 'output',
  reasoningTokens: 'thinking',
  totalTokens: 'step_total',
} as const

type TokenField = keyof typeof KIND_FOR_TOKEN_FIELD

const TOKEN_FIELDS = Object.keys(KIND_FOR_TOKEN_FIELD) as TokenField[]

// `inputTokens` -> `inputTokenRecordCount`: how many rows actually reported the
// field, so "nobody reported it" stays distinguishable from "everybody reported
// zero" (the summary omits the field in the first case).
function recordCountKey(field: TokenField): string {
  return `${field.replace(/s$/, '')}RecordCount`
}

// Each token field arrives alongside its `<field>RecordCount` sibling, whose
// key is computed — hence the dynamic read in tokenFields() rather than a
// wider index signature that would loosen provider/modelId to `number`.
type TokenAggregationRow = Partial<Record<TokenField, number>>

type TokenUsageSummaryTotalsAggregation = TokenAggregationRow & {
  recordCount: number
  modelCallCount: number
  toolCallCount: number
  lastRecordedAt?: Date
}

type TokenUsageProviderAggregation = TokenAggregationRow & {
  provider: string
  modelId: string
  recordCount: number
}

export type TokenUsageSummaryAggregation = {
  totals: TokenUsageSummaryTotalsAggregation[]
  providers: TokenUsageProviderAggregation[]
}

function totalsTokenAccumulators(): Document {
  const out: Document = {}

  for (const field of TOKEN_FIELDS) {
    const kind = KIND_FOR_TOKEN_FIELD[field]

    out[field] = {
      $sum: { $cond: [{ $eq: ['$kind', kind] }, { $ifNull: [`$tokens.${field}`, 0] }, 0] },
    }
    out[recordCountKey(field)] = {
      $sum: {
        $cond: [{ $and: [{ $eq: ['$kind', kind] }, { $ne: [`$tokens.${field}`, null] }] }, 1, 0],
      },
    }
  }

  return out
}

// The per-provider facet is already scoped to step_total rows, which carry the
// full per-call breakdown, so no per-field kind guard is needed here.
function providerTokenAccumulators(): Document {
  const out: Document = {}

  for (const field of TOKEN_FIELDS) {
    out[field] = { $sum: { $ifNull: [`$tokens.${field}`, 0] } }
    out[recordCountKey(field)] = {
      $sum: { $cond: [{ $ne: [`$tokens.${field}`, null] }, 1, 0] },
    }
  }

  return out
}

function providerProjection(): Document {
  const out: Document = {
    _id: 0,
    provider: '$_id.provider',
    modelId: '$_id.modelId',
    recordCount: 1,
  }

  for (const field of TOKEN_FIELDS) {
    out[field] = 1
    out[recordCountKey(field)] = 1
  }

  return out
}

export function tokenUsageSummaryPipeline(sessionId: string, userId: string): Document[] {
  return [
    { $match: { sessionId, userId } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              recordCount: { $sum: 1 },
              modelCallCount: { $sum: { $cond: [{ $eq: ['$kind', 'step_total'] }, 1, 0] } },
              toolCallCount: { $sum: { $cond: [{ $eq: ['$kind', 'tool_call'] }, 1, 0] } },
              ...totalsTokenAccumulators(),
              lastRecordedAt: { $max: '$createdAt' },
            },
          },
        ],
        providers: [
          { $match: { kind: 'step_total' } },
          {
            $group: {
              _id: { provider: '$provider', modelId: '$modelId' },
              recordCount: { $sum: 1 },
              ...providerTokenAccumulators(),
            },
          },
          { $project: providerProjection() },
        ],
      },
    },
  ]
}

function tokenFields(row: TokenAggregationRow): Partial<Record<TokenField, number>> {
  const counts = row as Record<string, number | undefined>
  const out: Partial<Record<TokenField, number>> = {}

  for (const field of TOKEN_FIELDS) {
    if ((counts[recordCountKey(field)] ?? 0) > 0) out[field] = row[field] ?? 0
  }

  return out
}

export function tokenUsageSummaryFromAggregation(
  aggregation: TokenUsageSummaryAggregation | undefined,
): AgentTokenUsageSummary | undefined {
  const totals = aggregation?.totals[0]

  if (!totals) return undefined

  return {
    ...tokenFields(totals),
    recordCount: totals.recordCount,
    modelCallCount: totals.modelCallCount,
    toolCallCount: totals.toolCallCount,
    providers: (aggregation?.providers ?? []).map((provider) =>
      cleanRecord({
        provider: provider.provider,
        modelId: provider.modelId,
        recordCount: provider.recordCount,
        ...tokenFields(provider),
      }),
    ),
    lastRecordedAt: totals.lastRecordedAt,
  }
}

export async function refreshConversationTokenUsageSummary(
  sessionId: string,
  userId: string,
  teamId?: string,
): Promise<void> {
  const [aggregation] = await agentTokenUsage()
    .aggregate<TokenUsageSummaryAggregation>(tokenUsageSummaryPipeline(sessionId, userId))
    .toArray()
  const summary = tokenUsageSummaryFromAggregation(aggregation)

  if (!summary) return

  await agentConversations().updateOne(conversationFilter(sessionId, userId, teamId), {
    $set: { tokenUsage: summary },
  })
}

function conversationFilter(sessionId: string, userId: string, teamId: string | undefined) {
  if (!teamId) return { sessionId, userId }

  return { sessionId, userId, $or: [{ teamId }, { teamId: { $exists: false } }] }
}
