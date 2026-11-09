import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'

import { recordRuntimeTurnUsage, writeRuntimeTurnUsage } from './turn-usage-record'

import type { AgentTokenUsageRecord } from './token-usage-db'

const inserted: AgentTokenUsageRecord[] = []
const conversationUpdates: { filter: unknown; update: unknown }[] = []
const failures: string[] = []
let insertError: Error | null = null
let summaryRows: unknown[] = []

const usageCollection = {
  insertMany: (rows: AgentTokenUsageRecord[]) => {
    if (insertError) throw insertError
    inserted.push(...rows)

    return Promise.resolve({ insertedCount: rows.length })
  },
  aggregate: () => ({ toArray: () => Promise.resolve(summaryRows) }),
}
const conversationCollection = {
  findOne: () =>
    Promise.resolve({ claudeCodePreview: { runtimeDefaults: { model: 'claude-opus-5' } } }),
  updateOne: (filter: unknown, update: unknown) => {
    conversationUpdates.push({ filter, update })

    return Promise.resolve({ modifiedCount: 1 })
  },
}

useDb({
  db: () => ({
    collection: (name: string) =>
      name === 'agent_token_usage' ? usageCollection : conversationCollection,
  }),
})
useObservability({
  logError: (event) => {
    failures.push(event)
  },
})

beforeEach(() => {
  inserted.length = 0
  conversationUpdates.length = 0
  failures.length = 0
  insertError = null
  summaryRows = []
})

// The recorder is fire-and-forget; one macrotask turn lets its whole chain
// (insert, then summary refresh) settle without waiting on a clock.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const turn = {
  sessionId: 'session-1',
  userId: 'user-1',
  teamId: 'team-1',
  provider: 'claude-code',
  usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
}

test('records a finished turn against its conversation', async () => {
  summaryRows = [
    { totals: [{ recordCount: 3, modelCallCount: 1, toolCallCount: 0 }], providers: [] },
  ]
  await writeRuntimeTurnUsage(turn)

  const byKind = new Map(inserted.map((row) => [row.kind, row]))

  expect([...byKind.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
    'input',
    'output',
    'step_total',
  ])
  expect(byKind.get('step_total')?.tokens).toEqual({
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
  })
  expect(byKind.get('input')?.tokens).toEqual({ inputTokens: 1000 })
  expect(byKind.get('output')?.tokens).toEqual({ outputTokens: 200 })
  for (const row of inserted) {
    expect(row).toMatchObject({
      sessionId: 'session-1',
      userId: 'user-1',
      teamId: 'team-1',
      provider: 'claude-code',
      modelId: 'claude-opus-5',
      operation: 'agent.turn',
      source: 'agent-runtime',
      accounting: 'upstream_reported',
    })
    expect(row.triggerId).toBeUndefined()
  }
  // The conversation's own total is rewritten from what was just written.
  expect(conversationUpdates).toHaveLength(1)
  expect(conversationUpdates[0]?.filter).toMatchObject({
    sessionId: 'session-1',
    userId: 'user-1',
  })
  expect(conversationUpdates[0]?.update).toEqual({ $set: { tokenUsage: expect.any(Object) } })
})

test('attributes a trigger-fired turn to its trigger and fire', async () => {
  await writeRuntimeTurnUsage({
    ...turn,
    trigger: { id: 'trigger-1', kind: 'scheduled', fireId: 'fire-1' },
  })

  expect(inserted.length).toBeGreaterThan(0)
  for (const row of inserted)
    expect(row).toMatchObject({
      triggerId: 'trigger-1',
      triggerKind: 'scheduled',
      triggerFireId: 'fire-1',
    })
})

test('a turn that reports no usage records nothing', async () => {
  await writeRuntimeTurnUsage({ ...turn, usage: {} })

  expect(inserted).toHaveLength(0)
  expect(conversationUpdates).toHaveLength(0)
})

test('a storage failure is logged and never fails the turn', async () => {
  insertError = new Error('synthetic database outage')
  // Not awaited: the point is that its rejection cannot escape.
  recordRuntimeTurnUsage(turn)
  await flush()

  expect(failures).toEqual(['agent.turn_usage.record_failed'])
  expect(conversationUpdates).toHaveLength(0)
})
