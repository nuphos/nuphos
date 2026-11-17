// The retention rollup against a real MongoDB: the scores its `$group` produces
// must be the ones the row-by-row fold (`computeRetentionScores`) gives.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb, db } from '@/lib/db'

import {
  attributionEvents,
  attributionScores,
  setupMemoryAttributionIndexes,
} from './attribution-db'
import { computeRetentionScores, resolveLineages, rollupRetentionScores } from './attribution-store'

import type {
  AttributionSignalEntry,
  AttributionTier,
  MemoryAttributionEvent,
  MemoryRetentionScore,
} from './attribution-types'

const now = new Date('2026-11-16T03:00:00Z')
const day = 24 * 60 * 60 * 1000
const team = new ObjectId().toHexString()
// Two playbook generations share one lineage; the rollup scores them as one.
const lineage = new ObjectId()
const older = new ObjectId()
const newer = new ObjectId()
const plain = `m-${new ObjectId().toHexString()}`
// The team memories collection, named here: memory-native is off limits to this module.
const teamMemories = () =>
  db().collection<{ _id: ObjectId; lineageId: string }>('agent_team_memories')

function row(
  i: number,
  memoryId: string,
  tier: AttributionTier,
  extra: Partial<MemoryAttributionEvent> = {},
): MemoryAttributionEvent {
  return {
    v: 1,
    key: `k-${team}-${String(i)}`,
    provider: 'native',
    teamId: team,
    userId: `u${String(i % 3)}`,
    conversationId: `c${String(i % 4)}`,
    turnKey: `t${String(i)}`,
    memoryId,
    lineage: null,
    scope: 'team',
    tier,
    signals: [],
    createdAt: new Date(now.getTime() - (i + 1) * day),
    updatedAt: new Date(now.getTime() - i * 3_600_000),
    ...extra,
  }
}

const judged = (at: Date): AttributionSignalEntry => ({
  signal: 'attribution_judge',
  verdict: 'applied',
  at,
})
const rows: MemoryAttributionEvent[] = [
  row(1, older.toHexString(), 'applied', { signals: [judged(new Date(now.getTime() - 5 * day))] }),
  row(2, newer.toHexString(), 'applied', { signals: [judged(new Date(now.getTime() - 2 * day))] }),
  // Applied with no verdict signal: dated by the row itself.
  row(3, newer.toHexString(), 'applied'),
  row(4, newer.toHexString(), 'considered', {
    signals: [{ signal: 'supersede_correction', at: now } as never],
  }),
  row(5, older.toHexString(), 'not_applicable'),
  row(6, plain, 'recalled' as AttributionTier),
  row(7, plain, 'applied', {
    teamId: null,
    signals: [
      { signal: 'human_feedback', verdict: 'applied', at: new Date(now.getTime() - day) } as never,
    ],
  }),
  row(8, plain, 'considered', { teamId: null }),
]
// Outside the window, or another provider: never scored.
const ignored = [
  row(9, plain, 'applied', { updatedAt: new Date(now.getTime() - 91 * day) }),
  row(10, plain, 'applied', { provider: 'mem0' }),
]

describe.skipIf(!process.env.TEST_MONGODB_URI)('rollupRetentionScores on a real database', () => {
  beforeAll(async () => {
    await connectDb()
    // The indexes startup creates, as the score upserts expect.
    await setupMemoryAttributionIndexes()
    await attributionEvents().deleteMany({ teamId: { $in: [team, null] } })
    await attributionScores().deleteMany({ provider: 'native' })
    await attributionEvents().insertMany([...rows, ...ignored])
    await teamMemories().insertMany([
      { _id: older, lineageId: lineage.toHexString() },
      { _id: newer, lineageId: lineage.toHexString() },
    ])
  })
  afterAll(async () => {
    await attributionEvents().deleteMany({ teamId: { $in: [team, null] } })
    await teamMemories().deleteMany({ _id: { $in: [older, newer] } })
    await closeDb()
  })

  test('scores what the row-by-row fold scores', async () => {
    const lineages = await resolveLineages(rows.map((r) => r.memoryId))
    const expected = computeRetentionScores(rows, (id) => lineages.get(id) ?? id, now)

    expect(await rollupRetentionScores(now)).toBe(expected.length)
    // The projection drops `_id`, which the collection's type always carries.
    const stored = (await attributionScores()
      .find({ provider: 'native' }, { projection: { _id: 0 } })
      .toArray()) as MemoryRetentionScore[]
    const byKey = (s: { teamId: string | null; lineage: string }) =>
      `${s.teamId ?? ''}|${s.lineage}`

    expect(stored.toSorted((a, b) => byKey(a).localeCompare(byKey(b)))).toEqual(
      expected.toSorted((a, b) => byKey(a).localeCompare(byKey(b))),
    )
    // The two generations folded into their lineage: 5 turns, 3 applied.
    expect(stored.find((s) => s.lineage === lineage.toHexString())).toMatchObject({
      turns: 5,
      applied: 3,
      corrections: 1,
    })
  })
})
