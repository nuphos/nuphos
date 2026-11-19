import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getTriggerUsage, triggerUsagePipeline } from './trigger-usage'

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
  expect(usage.fires).toEqual([])
})

test('the pipeline groups by fire and carries the fire id and first time through', () => {
  const [, group, project] = triggerUsagePipeline({ triggerId: 'trigger-1' })

  expect(group).toMatchObject({
    $group: {
      _id: {
        sessionId: '$sessionId',
        fireId: '$triggerFireId',
        provider: '$provider',
        modelId: '$modelId',
      },
      firstRecordedAt: { $min: '$createdAt' },
      lastRecordedAt: { $max: '$createdAt' },
    },
  })
  expect(project).toMatchObject({
    $project: { fireId: '$_id.fireId', firstRecordedAt: 1, lastRecordedAt: 1 },
  })
})

function fire(fireId: string, day: string, tokens: number): Record<string, unknown> {
  return row({
    sessionId: 'bound',
    fireId,
    firstRecordedAt: new Date(`2026-11-0${day}T08:00:00.000Z`),
    lastRecordedAt: new Date(`2026-11-0${day}T08:05:00.000Z`),
    inputTokens: tokens,
    totalTokens: tokens,
  })
}

test('a bound trigger with three fires is one session row and three fire rows', async () => {
  // Out of order on purpose: the runs get more expensive as the conversation grows.
  rows = [fire('fire-2', '4', 2000), fire('fire-3', '6', 3000), fire('fire-1', '3', 1000)]
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.sessions).toHaveLength(1)
  expect(usage.sessions[0]).toMatchObject({ sessionId: 'bound', inputTokens: 6000, turns: 3 })
  expect(usage.fires.map((f) => f.fireId)).toEqual(['fire-3', 'fire-2', 'fire-1'])
  expect(usage.fires.map((f) => f.inputTokens)).toEqual([3000, 2000, 1000])
  expect(usage.fires[0]).toMatchObject({
    sessionId: 'bound',
    firstRecordedAt: '2026-11-06T08:00:00.000Z',
    lastRecordedAt: '2026-11-06T08:05:00.000Z',
  })
  expect(usage.fires[0]?.costUsd).toBeCloseTo((3000 * 5) / 1e6, 12)
  expect(usage.fires[2]?.costUsd).toBeCloseTo((1000 * 5) / 1e6, 12)
})

test('rows of one fire across models add up, and the cost skips unpriced models', async () => {
  rows = [
    row({ sessionId: 's', fireId: 'fire-1', inputTokens: 1000, totalTokens: 1000 }),
    row({ sessionId: 's', fireId: 'fire-1', modelId: 'mystery-model', totalTokens: 40 }),
  ]
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.fires).toHaveLength(1)
  expect(usage.fires[0]).toMatchObject({ turns: 2, totalTokens: 1040 })
  expect(usage.fires[0]?.costUsd).toBeCloseTo((1000 * 5) / 1e6, 12)
})

test('a fire starts at the earliest first turn among its model rows', async () => {
  rows = [
    row({
      sessionId: 's',
      fireId: 'fire-1',
      firstRecordedAt: new Date('2026-11-05T08:02:00.000Z'),
      lastRecordedAt: new Date('2026-11-05T08:09:00.000Z'),
    }),
    row({
      sessionId: 's',
      fireId: 'fire-1',
      modelId: 'claude-sonnet-5',
      firstRecordedAt: new Date('2026-11-05T08:00:00.000Z'),
      lastRecordedAt: new Date('2026-11-05T08:04:00.000Z'),
    }),
  ]
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.fires).toHaveLength(1)
  expect(usage.fires[0]).toMatchObject({
    firstRecordedAt: '2026-11-05T08:00:00.000Z',
    lastRecordedAt: '2026-11-05T08:09:00.000Z',
  })
})

test('fires that start at the same moment are ordered by fire id', async () => {
  const at = new Date('2026-11-05T08:00:00.000Z')

  rows = [
    row({ sessionId: 's', fireId: 'fire-b', firstRecordedAt: at }),
    row({ sessionId: 's', fireId: 'fire-a', firstRecordedAt: at }),
  ]
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.fires.map((f) => f.fireId)).toEqual(['fire-a', 'fire-b'])
})

test('turns without a fire id count in totals and sessions but are not a fire', async () => {
  rows = [
    row({ sessionId: 'bound', fireId: 'fire-1', inputTokens: 100, totalTokens: 100 }),
    row({ sessionId: 'bound', fireId: null, inputTokens: 400, totalTokens: 400 }),
    row({ sessionId: 'other', inputTokens: 50, totalTokens: 50 }),
  ]
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.totals.totalTokens).toBe(550)
  expect(usage.sessions.map((s) => [s.sessionId, s.totalTokens])).toEqual([
    ['bound', 500],
    ['other', 50],
  ])
  expect(usage.fires.map((f) => f.fireId)).toEqual(['fire-1'])
  expect(usage.fires[0]?.totalTokens).toBe(100)
})

test('lists at most the 50 most recent fires', async () => {
  rows = Array.from({ length: 60 }, (_, i) =>
    row({
      sessionId: 'bound',
      fireId: `fire-${String(i)}`,
      firstRecordedAt: new Date(Date.UTC(2026, 10, 3, 0, i)),
      totalTokens: 1,
    }),
  )
  const usage = await getTriggerUsage('trigger-1', 'team-1', 7, NOW)

  expect(usage.fires).toHaveLength(50)
  expect(usage.fires[0]?.fireId).toBe('fire-59')
  expect(usage.fires[49]?.fireId).toBe('fire-10')
  expect(usage.totals.totalTokens).toBe(60)
})
