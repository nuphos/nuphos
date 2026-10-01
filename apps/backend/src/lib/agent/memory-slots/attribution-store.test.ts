import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { LIVE_RECORD_FILTER, memoryRecordAccessFilter } from '@/lib/agent/memory-native/store'
import { useDb } from '@/lib/test/doubles/db'

import {
  computeRetentionScores,
  computeTurnScorecard,
  countAutoLearnedMemoriesSince,
  deriveTier,
  filterOwnedMemoryIds,
  purgeConversationAttribution,
  recordAttributionSignal,
  recordTurnDistillOutcome,
} from './attribution-store'

import type { MemoryAttributionEvent, AttributionSignalEntry } from './attribution-types'
import type * as dbActual from '@/lib/db'

// Name-keyed, upsert-capable stand-in ($setOnInsert + upsert + deleteMany),
// which the memory-native FakeCollection does not model.
class Fake {
  docs: Record<string, unknown>[] = []
  private m(f: Record<string, unknown>) {
    return this.docs.find((d) => Object.entries(f).every(([k, v]) => d[k] === v))
  }
  async findOne(f: Record<string, unknown>) {
    return this.m(f) ?? null
  }
  async updateOne(
    f: Record<string, unknown>,
    u: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
    o?: { upsert?: boolean },
  ) {
    const hit = this.m(f)

    if (hit) {
      Object.assign(hit, u.$set ?? {})

      return { upsertedCount: 0 }
    }
    if (o?.upsert) {
      this.docs.push({ ...(u.$setOnInsert ?? {}), ...(u.$set ?? {}) })

      return { upsertedCount: 1 }
    }

    return { upsertedCount: 0 }
  }
  async deleteMany(f: Record<string, unknown>) {
    const before = this.docs.length

    this.docs = this.docs.filter((d) => !Object.entries(f).every(([k, v]) => d[k] === v))

    return { deletedCount: before - this.docs.length }
  }
  async createIndex() {
    return ''
  }
  // Capture-style query surface for the scorecard helpers: the Mongo filter
  // shapes ($or access filter, $in id sets) are the contract under test, not
  // query evaluation — record the filter, serve a canned result.
  lastCountFilter: Record<string, unknown> | null = null
  countResult = 0
  async countDocuments(f: Record<string, unknown>) {
    this.lastCountFilter = f

    return this.countResult
  }
  lastFindFilter: Record<string, unknown> | null = null
  findResult: Record<string, unknown>[] = []
  find(f: Record<string, unknown>) {
    this.lastFindFilter = f
    const rows = this.findResult

    return {
      toArray: async () => rows,
      sort: () => ({ toArray: async () => rows }),
    }
  }
}
const byName = new Map<string, Fake>()
const coll = (name: string) => {
  let c = byName.get(name)

  if (!c) {
    c = new Fake()
    byName.set(name, c)
  }

  return c
}

useDb({ db: (() => ({ collection: coll })) as unknown as typeof dbActual.db })

// Read through the fake map, not the store's typed Collection handles — the
// Mongo Collection type (rightly) has no `.docs`.
const rows = () => coll('memory_runtime_attributions').docs
const turnRows = () => coll('memory_runtime_turns').docs

const base = {
  provider: 'native',
  teamId: null,
  userId: 'u1',
  conversationId: 'c1',
  turnKey: 'req1',
  memoryId: 'm1',
  lineage: 'lin1',
  scope: 'team' as const,
}
const sig = (
  s: AttributionSignalEntry['signal'],
  verdict?: AttributionSignalEntry['verdict'],
  note?: string,
): AttributionSignalEntry => ({
  signal: s,
  at: new Date(),
  ...(verdict ? { verdict } : {}),
  ...(note ? { note } : {}),
})

describe('deriveTier precedence (A4③)', () => {
  test('recall floor', () => expect(deriveTier([sig('recall_log')])).toBe('recalled'))
  test('fetch beats recall', () =>
    expect(deriveTier([sig('recall_log'), sig('fetch_log')])).toBe('fetched'))
  test('judge beats fetch', () =>
    expect(deriveTier([sig('fetch_log'), sig('attribution_judge', 'applied')])).toBe('applied'))
  test('supersede beats judge', () =>
    expect(deriveTier([sig('attribution_judge', 'applied'), sig('supersede_correction')])).toBe(
      'not_applicable',
    ))
  test('human overrides all', () =>
    expect(deriveTier([sig('supersede_correction'), sig('human_feedback', 'applied')])).toBe(
      'applied',
    ))
})

describe('recordAttributionSignal', () => {
  beforeEach(() =>
    byName.forEach((c) => {
      c.docs = []
    }),
  )

  test('one row per key; fetch upgrades an existing recalled row', async () => {
    await recordAttributionSignal({ ...base, signal: sig('recall_log') })
    await recordAttributionSignal({ ...base, signal: sig('fetch_log') })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.tier).toBe('fetched')
  })

  test('idempotent: same signal type replaces, never appends', async () => {
    await recordAttributionSignal({ ...base, signal: sig('recall_log') })
    await recordAttributionSignal({ ...base, signal: sig('recall_log') })
    const row = rows()[0]! as { signals: unknown[] }

    expect(row.signals).toHaveLength(1)
  })

  test('note is redacted and capped at 300 chars', async () => {
    // AKIA… is a canonical AWS key the redact rules always catch (same fixture
    // as findSecretBearingContent's test); placed early so both the redaction
    // and the 300-char cap are exercised independently of each other.
    const note = `creds AKIAIOSFODNN7EXAMPLE follow ${'x'.repeat(400)}`

    await recordAttributionSignal({
      ...base,
      signal: sig('human_feedback', 'not_applicable', note),
    })
    const row = rows()[0]! as { signals: { note?: string }[] }

    expect(row.signals[0]!.note!.length).toBeLessThanOrEqual(300)
    expect(row.signals[0]!.note).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })
})

describe('recordTurnDistillOutcome', () => {
  beforeEach(() =>
    byName.forEach((c) => {
      c.docs = []
    }),
  )

  test('overwrites the capture-time default on the existing turn row only', async () => {
    // Capture wrote the row first (same chain); the hook must update, not upsert.
    turnRows().push({ conversationId: 'c1', turnKey: 't1', distill: 'skipped_disabled' })
    await recordTurnDistillOutcome('c1', 't1', 'no_learn')
    expect(turnRows()[0]!.distill).toBe('no_learn')
    await recordTurnDistillOutcome('c1', 'other-turn', 'saved')
    expect(turnRows()).toHaveLength(1) // no phantom row for an unknown turn
  })
})

describe('purgeConversationAttribution (A6)', () => {
  beforeEach(() =>
    byName.forEach((c) => {
      c.docs = []
    }),
  )

  test('removes all rows for a conversation', async () => {
    await recordAttributionSignal({ ...base, signal: sig('recall_log') })
    expect(rows()).toHaveLength(1)
    await purgeConversationAttribution('c1')
    expect(rows()).toHaveLength(0)
    expect(turnRows()).toHaveLength(0)
  })
})

describe('computeTurnScorecard (Track A 2.3)', () => {
  const turn = (over: Partial<import('./attribution-types').MemoryTurnSummary>) =>
    ({
      provider: 'native',
      teamId: 't1',
      userId: 'u1',
      conversationId: 'c1',
      turnKey: 'k',
      deliveryMode: 'automatic',
      recalledCount: 0,
      fetchedCount: 0,
      judge: 'skipped_disabled',
      appliedCount: 0,
      distill: 'skipped_disabled',
      at: new Date(),
      ...over,
    }) as import('./attribution-types').MemoryTurnSummary

  test('returns rates, not just counts; empty pool yields zero rates', () => {
    expect(computeTurnScorecard([]).turns.recallRate).toBe(0)
    const s = computeTurnScorecard([
      turn({ recalledCount: 5, appliedCount: 1, judge: 'ran', distill: 'no_learn' }),
      turn({ recalledCount: 3, judge: 'ran', distill: 'saved' }),
      turn({}), // zero-recall denominator turn
      turn({ judge: 'failed' }),
    ])

    expect(s.turns.total).toBe(4)
    expect(s.turns.recallRate).toBeCloseTo(0.5)
    expect(s.turns.zeroRecallRate).toBeCloseTo(0.5)
    expect(s.turns.appliedRate).toBeCloseTo(0.25)
    expect(s.judge.ran).toBe(2)
    expect(s.judge.failed).toBe(1)
    expect(s.judge.ranRate).toBeCloseTo(0.5)
    expect(s.distill.no_learn).toBe(1)
    expect(s.distill.saved).toBe(1)
  })

  test('rows predating the distill field do not distort its counts', () => {
    const legacy = turn({})

    delete (legacy as { distill?: unknown }).distill
    const s = computeTurnScorecard([legacy, turn({ distill: 'saved' })])

    expect(s.distill.saved).toBe(1)
    expect(Object.values(s.distill).reduce((a, b) => a + b, 0)).toBe(1)
  })
})

describe('computeRetentionScores (Track A 2.2)', () => {
  const at = new Date('2026-07-01T00:00:00Z')
  const row = (over: Partial<MemoryAttributionEvent>): MemoryAttributionEvent => ({
    v: 1,
    key: `k-${String(
      Math.abs(
        JSON.stringify(over)
          .split('')
          .reduce((a, c) => a + c.charCodeAt(0), 0),
      ),
    )}`,
    provider: 'native',
    teamId: 't1',
    userId: 'u1',
    conversationId: 'c1',
    turnKey: 'turn-1',
    memoryId: 'm1',
    lineage: null,
    scope: 'team',
    tier: 'recalled',
    signals: [{ signal: 'recall_log', at }],
    createdAt: at,
    updatedAt: at,
    ...over,
  })
  const identity = (id: string) => id

  test('applied 3 of 10 turns scores applyRate 0.3; never-applied scores 0', () => {
    const rows: MemoryAttributionEvent[] = []

    for (let i = 0; i < 10; i++) {
      rows.push(
        row({
          turnKey: `turn-${String(i)}`,
          conversationId: `c${String(i % 4)}`,
          tier: i < 3 ? 'applied' : 'recalled',
        }),
      )
      rows.push(row({ turnKey: `turn-${String(i)}`, memoryId: 'm2', tier: 'recalled' }))
    }
    const scores = computeRetentionScores(rows, identity, at)
    const m1 = scores.find((s) => s.lineage === 'm1')!
    const m2 = scores.find((s) => s.lineage === 'm2')!

    expect(m1.applyRate).toBeCloseTo(0.3)
    expect(m1.turns).toBe(10)
    expect(m1.reachConversations).toBe(4)
    expect(m2.applyRate).toBe(0)
    expect(m2.lastAppliedAt).toBeNull()
  })

  test('lineage resolver folds revisions together; corrections and human negatives counted', () => {
    const scores = computeRetentionScores(
      [
        row({ memoryId: 'rev-1', tier: 'applied' }),
        row({
          memoryId: 'rev-2',
          turnKey: 'turn-2',
          userId: 'u2',
          tier: 'not_applicable',
          signals: [
            { signal: 'supersede_correction', at },
            { signal: 'human_feedback', at, verdict: 'not_applicable' },
          ],
        }),
      ],
      () => 'lineage-A',
      at,
    )

    expect(scores).toHaveLength(1)
    const s = scores[0]!

    expect(s.lineage).toBe('lineage-A')
    expect(s.turns).toBe(2)
    expect(s.corrections).toBe(1)
    expect(s.reachUsers).toBe(2)
  })
})

// ── Scorecard reads moved out of routes/agent.ts (Phase 2 PR 2) ─────────────
// The GET /memories/scorecard route no longer imports memory-native/store;
// these helpers carry the two native reads it needs, with the EXACT legacy
// filter shapes (memoryRecordAccessFilter + LIVE_RECORD_FILTER) preserved.

describe('countAutoLearnedMemoriesSince', () => {
  beforeEach(() =>
    byName.forEach((c) => {
      c.docs = []
    }),
  )

  test('counts live auto_ingest records with the legacy access filter', async () => {
    const since = new Date('2026-07-24T00:00:00.000Z')
    const fake = coll('agent_memories')

    fake.countResult = 4
    await expect(countAutoLearnedMemoriesSince('u1', 't1', since)).resolves.toBe(4)
    expect(fake.lastCountFilter).toEqual({
      source: 'auto_ingest',
      createdAt: { $gte: since },
      ...memoryRecordAccessFilter('u1', 't1'),
      ...LIVE_RECORD_FILTER,
    })
  })

  test('no team: the access filter narrows to the solo personal pool', async () => {
    const since = new Date('2026-07-24T00:00:00.000Z')

    await countAutoLearnedMemoriesSince('u1', undefined, since)
    expect(coll('agent_memories').lastCountFilter).toEqual({
      source: 'auto_ingest',
      createdAt: { $gte: since },
      ...memoryRecordAccessFilter('u1', undefined),
      ...LIVE_RECORD_FILTER,
    })
  })
})

describe('filterOwnedMemoryIds', () => {
  const idA = new ObjectId()
  const idB = new ObjectId()
  const idC = new ObjectId()

  beforeEach(() => {
    byName.forEach((c) => {
      c.docs = []
      c.findResult = []
      c.lastFindFilter = null
    })
  })

  test('keeps requested order; records and playbooks both count as owned', async () => {
    coll('agent_memories').findResult = [{ _id: idB }]
    coll('agent_team_memories').findResult = [{ _id: idA }]
    const owned = await filterOwnedMemoryIds('u1', 't1', [
      idA.toHexString(),
      idB.toHexString(),
      idC.toHexString(),
    ])

    expect(owned).toEqual([idA.toHexString(), idB.toHexString()])
    // Legacy filter shapes, verbatim.
    expect(coll('agent_memories').lastFindFilter).toEqual({
      _id: { $in: [idA, idB, idC] },
      ...memoryRecordAccessFilter('u1', 't1'),
    })
    expect(coll('agent_team_memories').lastFindFilter).toEqual({
      _id: { $in: [idA, idB, idC] },
      teamId: 't1',
    })
  })

  test('without a team the playbook store is never queried', async () => {
    coll('agent_memories').findResult = [{ _id: idA }]
    const owned = await filterOwnedMemoryIds('u1', undefined, [
      idA.toHexString(),
      idB.toHexString(),
    ])

    expect(owned).toEqual([idA.toHexString()])
    expect(coll('agent_team_memories').lastFindFilter).toBeNull()
  })

  test('empty input short-circuits to an empty result', async () => {
    await expect(filterOwnedMemoryIds('u1', 't1', [])).resolves.toEqual([])
    expect(coll('agent_memories').lastFindFilter).toBeNull()
  })
})
