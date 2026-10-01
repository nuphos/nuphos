import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { byCodeUnit } from '@/lib/agent/sort-order'
import { useDb } from '@/lib/test/doubles/db'

import { captureTurnAttribution } from './attribution-capture'

import type * as dbActual from '@/lib/db'

// Same upsert-capable Fake as attribution-store.test.ts (both modules only
// need findOne/updateOne-with-upsert/deleteMany against @/lib/db).
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
      // Real Mongo folds the filter's equality fields into the upserted doc.
      this.docs.push({ ...f, ...(u.$setOnInsert ?? {}), ...(u.$set ?? {}) })

      return { upsertedCount: 1 }
    }

    return { upsertedCount: 0 }
  }
  async deleteMany() {
    return { deletedCount: 0 }
  }
  async createIndex() {
    return ''
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

const rows = () => coll('memory_runtime_attributions').docs
const turns = () => coll('memory_runtime_turns').docs

const baseTurn = {
  teamId: 't1' as string | null,
  userId: 'u1',
  conversationId: 'sess-1',
  turnKey: 'req-1',
  deliveryMode: 'injection',
  recallOutcome: 'matched' as const,
}

describe('captureTurnAttribution', () => {
  beforeEach(() =>
    byName.forEach((c) => {
      c.docs = []
    }),
  )

  test('recalled + fetched produce rows with correct scope and tier', async () => {
    await captureTurnAttribution({
      ...baseTurn,
      recalledTeamIds: ['g1', 'g2'],
      recalledPersonalIds: ['r1'],
      fetchedTeamIds: ['g1'], // g1 was recalled AND opened
      fetchedPersonalIds: [],
    })
    expect(rows()).toHaveLength(3) // g1 merged into one row, not duplicated
    const g1 = rows().find((r) => r.memoryId === 'g1')!

    expect(g1.tier).toBe('fetched')
    expect(g1.scope).toBe('team')
    // BOTH signals must survive on the merged row — a concurrent write once
    // lost fetch_log to the recall_log writer (lost-update race).
    expect((g1.signals as { signal: string }[]).map((s) => s.signal).sort(byCodeUnit)).toEqual([
      'fetch_log',
      'recall_log',
    ])
    const r1 = rows().find((r) => r.memoryId === 'r1')!

    expect(r1.tier).toBe('recalled')
    expect(r1.scope).toBe('personal')
    expect(rows().every((r) => r.provider === 'native' && r.turnKey === 'req-1')).toBe(true)
  })

  test('fetched-only turn (recall skipped) still records the fetch', async () => {
    await captureTurnAttribution({
      ...baseTurn,
      recalledTeamIds: [],
      recalledPersonalIds: [],
      fetchedTeamIds: [],
      fetchedPersonalIds: ['r9'],
    })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.tier).toBe('fetched')
  })

  test('turn summary row carries counts, deliveryMode, judge + distill defaults', async () => {
    await captureTurnAttribution({
      ...baseTurn,
      recalledTeamIds: ['g1'],
      recalledPersonalIds: ['r1'],
      fetchedTeamIds: ['g1'],
      fetchedPersonalIds: [],
    })
    expect(turns()).toHaveLength(1)
    const t = turns()[0]!

    expect(t.recalledCount).toBe(2)
    expect(t.fetchedCount).toBe(1)
    expect(t.deliveryMode).toBe('injection')
    expect(t.judge).toBe('skipped_disabled')
    expect(t.distill).toBe('skipped_disabled')
  })

  test('superseding a recalled memory records the correction and sinks its tier', async () => {
    // The typical correction flow: old memory recalled → agent notices it is
    // wrong → saves replacement with supersedes. One row, both signals, and
    // the negative wins the tier (A4③ precedence: supersede beats fetch/recall).
    await captureTurnAttribution({
      ...baseTurn,
      recalledTeamIds: [],
      recalledPersonalIds: ['r1'],
      fetchedTeamIds: [],
      fetchedPersonalIds: [],
      supersededPersonalIds: ['r1'],
    })
    expect(rows()).toHaveLength(1)
    const r1 = rows()[0]!

    expect(r1.tier).toBe('not_applicable')
    expect((r1.signals as { signal: string }[]).map((s) => s.signal).sort(byCodeUnit)).toEqual([
      'recall_log',
      'supersede_correction',
    ])
  })

  test('provider defaults to native; an explicit provider stamps rows AND the turn row', async () => {
    // Default: existing finalizer callers pass no provider — Track A rows
    // keep their 'native' stamp unchanged.
    await captureTurnAttribution({
      ...baseTurn,
      recalledTeamIds: ['g1'],
      recalledPersonalIds: [],
      fetchedTeamIds: [],
      fetchedPersonalIds: [],
    })
    expect(rows()[0]!.provider).toBe('native')
    expect(turns()[0]!.provider).toBe('native')

    // Phase 2: the runtime stamps the RESOLVED provider at the call boundary
    // (decision 3 — a bare id without its provider tag is meaningless).
    await captureTurnAttribution({
      ...baseTurn,
      conversationId: 'sess-2',
      provider: 'vendor-x',
      recalledTeamIds: ['g9'],
      recalledPersonalIds: [],
      fetchedTeamIds: [],
      fetchedPersonalIds: [],
    })
    const vendorRow = rows().find((r) => r.memoryId === 'g9')!

    expect(vendorRow.provider).toBe('vendor-x')
    expect(turns().find((t) => t.conversationId === 'sess-2')!.provider).toBe('vendor-x')
  })

  test('zero-recall turn writes the denominator row but no attribution rows', async () => {
    await captureTurnAttribution({
      ...baseTurn,
      recalledTeamIds: [],
      recalledPersonalIds: [],
      fetchedTeamIds: [],
      fetchedPersonalIds: [],
    })
    expect(rows()).toHaveLength(0)
    expect(turns()).toHaveLength(1)
    expect(turns()[0]!.recalledCount).toBe(0)
  })
})

test('recallOutcome lands on the turns row', async () => {
  await captureTurnAttribution({
    ...baseTurn,
    recallOutcome: 'no_match',
    recalledTeamIds: [],
    recalledPersonalIds: [],
    fetchedTeamIds: [],
    fetchedPersonalIds: [],
  })

  const row = turns().find((t) => t.turnKey === 'req-1')

  // The field this investigation lacked: recalledCount 0 alone cannot say
  // whether the search matched nothing or never ran.
  expect(row?.recallOutcome).toBe('no_match')
  expect(row?.recalledCount).toBe(0)
})
