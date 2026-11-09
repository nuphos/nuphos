import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getTriggerUsage } from './trigger-usage'

import type { Document } from 'mongodb'

let rows: Record<string, unknown>[] = []
let matchStage: Document | null = null

const usageCollection = {
  aggregate: (pipeline: Document[]) => {
    matchStage = pipeline[0] ?? null

    return { toArray: () => Promise.resolve(rows) }
  },
}

useDb({ db: () => ({ collection: () => usageCollection }) })

beforeEach(() => {
  rows = []
  matchStage = null
})

const NOW = new Date('2026-11-09T12:00:00.000Z')

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    provider: 'claude-code',
    modelId: 'claude-opus-5',
    turns: 1,
    lastRecordedAt: new Date('2026-11-08T10:00:00.000Z'),
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    ...overrides,
  }
}

test('scopes the aggregation to the trigger, its team and the last seven days', async () => {
  await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(matchStage).toEqual({
    $match: {
      triggerId: 'trigger-1',
      teamId: 'team-1',
      createdAt: { $gte: new Date('2026-11-02T12:00:00.000Z') },
    },
  })
})

test('totals usage across fires and splits it by conversation', async () => {
  rows = [
    row({ sessionId: 'session-1', inputTokens: 1000, outputTokens: 100, totalTokens: 1100 }),
    row({
      sessionId: 'session-2',
      turns: 2,
      lastRecordedAt: new Date('2026-11-09T09:00:00.000Z'),
      inputTokens: 500,
      outputTokens: 50,
      totalTokens: 550,
    }),
  ]
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.since).toBe('2026-11-02T12:00:00.000Z')
  expect(usage.totals).toMatchObject({
    inputTokens: 1500,
    outputTokens: 150,
    totalTokens: 1650,
    turns: 3,
    lastRecordedAt: '2026-11-09T09:00:00.000Z',
  })
  // Priced per model from the shared pricing table, so the total matches what
  // the same rows would cost in the team usage page.
  expect(usage.totals.costUsd).toBeCloseTo((1500 * 5 + 150 * 25) / 1e6, 12)
  // Most expensive first.
  expect(usage.sessions.map((session) => session.sessionId)).toEqual(['session-1', 'session-2'])
  expect(usage.sessions[0]?.turns).toBe(1)
  expect(usage.sessions[1]?.turns).toBe(2)
})

test('leaves the cost out when no recorded model has a known price', async () => {
  rows = [row({ sessionId: 'session-1', modelId: 'mystery-model', totalTokens: 10 })]
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.totals.totalTokens).toBe(10)
  expect(usage.totals).not.toHaveProperty('costUsd')
})

test('a trigger that has not fired in the window totals zero, not an estimate', async () => {
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.totals).toEqual({
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    turns: 0,
  })
  expect(usage.sessions).toEqual([])
})
