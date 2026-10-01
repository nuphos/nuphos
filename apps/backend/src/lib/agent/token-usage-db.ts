import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { Collection } from 'mongodb'

export type AgentTokenUsageKind =
  'turn_total' | 'step_total' | 'input' | 'output' | 'thinking' | 'tool_call'

export type AgentTokenUsageAccounting = 'upstream_reported'

export type AgentTokenUsageTokens = {
  // The TOTAL prompt count: uncached + cacheRead + cacheWrite (this is what the
  // AI SDK reports as `inputTokens`, and what the Anthropic providers compute
  // as input_tokens + cache_read_input_tokens + cache_creation_input_tokens).
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  // Cache READ tokens (Anthropic `cache_read_input_tokens`), a subset of
  // inputTokens billed at ~10% of the input rate.
  cachedInputTokens?: number
  // Cache WRITE tokens (Anthropic `cache_creation_input_tokens`), also a subset
  // of inputTokens, but billed at a PREMIUM (1.25x input for the 5-minute TTL).
  // Absent on rows written before cache-write accounting shipped — those rows
  // under-bill their cache writes at the plain input rate.
  cacheWriteTokens?: number
}

export type AgentTokenUsageProviderTotal = AgentTokenUsageTokens & {
  provider: string
  modelId: string
  recordCount: number
  costUsd?: number
}

export type AgentTokenUsageSummary = AgentTokenUsageTokens & {
  recordCount: number
  modelCallCount: number
  toolCallCount: number
  providers: AgentTokenUsageProviderTotal[]
  costUsd?: number
  lastRecordedAt?: Date
}

export type AgentTokenUsageRecord = {
  recordId: string
  sessionId: string
  userId: string
  teamId?: string
  requestId?: string
  streamId?: string
  operation: string
  source: 'ai-sdk' | 'google-genai'
  kind: AgentTokenUsageKind
  accounting: AgentTokenUsageAccounting
  // Absent on rows written before pool accounting shipped.
  billing?: UsageBillingClass
  // Frozen when the call is recorded so exact cycle-boundary accounting does
  // not change if the model pricing table changes later. Legacy rows omit it.
  providerCostUsd?: number
  provider: string
  modelId: string
  region?: string
  // Vertex only: the GCP project the request was billed to, so a row can be
  // reconciled one-for-one against the BigQuery billing export (which keys on
  // project + location + SKU). Location is already stored as `region`. Never
  // holds credentials — a project id is not a secret, and is exactly what the
  // billing export exposes.
  gcpProject?: string
  stepIndex?: number
  stepNumber?: number
  finishReason?: string
  toolCallId?: string
  toolName?: string
  parentRecordId?: string
  tokenCount?: number
  tokens: AgentTokenUsageTokens
  rawUsage?: Record<string, unknown>
  createdAt: Date
}

const COLLECTION_NAME = 'agent_token_usage'

export const agentTokenUsage = (): Collection<AgentTokenUsageRecord> =>
  db().collection<AgentTokenUsageRecord>(COLLECTION_NAME)

export async function setupTokenUsageIndexes(): Promise<void> {
  const c = agentTokenUsage()

  try {
    await c.createIndex({ recordId: 1 }, { unique: true, background: true })
    await c.createIndex({ sessionId: 1, userId: 1, createdAt: 1 }, { background: true })
    await c.createIndex({ userId: 1, createdAt: -1 }, { background: true })
    await c.createIndex({ provider: 1, modelId: 1, createdAt: -1 }, { background: true })
    // Backs the team-wide, time-ranged usage aggregation (getTeamUsageSummary).
    await c.createIndex({ teamId: 1, createdAt: -1 }, { background: true })
  } catch (err) {
    logError('agent.token_usage.indexes_create_failed', err)
  }
}

export function cleanRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T
}

/** Legacy categories remain readable; new usage is uncharged background usage. */
export type UsageBillingClass = 'billable' | 'on_demand' | 'background'
