import { beforeEach, describe, expect, test } from 'bun:test'

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
}

describe('captureTurnAttribution', () => {
  beforeEach(() =>
    byName.forEach((c) => {
      c.docs = []
    }),
  )

  test('fetched memories produce rows with correct scope and tier', async () => {
    await captureTurnAttribution({
      ...baseTurn,
      fetchedTeamIds: ['g1'],
      fetchedPersonalIds: ['r1'],
    })
    expect(rows()).toHaveLength(2)
    const g1 = rows().find((r) => r.memoryId === 'g1')!

    expect(g1.tier).toBe('fetched')
    expect(g1.scope).toBe('team')
    expect(rows().find((r) => r.memoryId === 'r1')!.scope).toBe('personal')
    expect(rows().every((r) => r.provider === 'native' && r.turnKey === 'req-1')).toBe(true)
  })

  test('turn summary row carries the fetch count and the judge default only', async () => {
    await captureTurnAttribution({
      ...baseTurn,
      fetchedTeamIds: ['g1'],
      fetchedPersonalIds: [],
    })
    expect(turns()).toHaveLength(1)
    const t = turns()[0]!

    expect(t.fetchedCount).toBe(1)
    expect(t.judge).toBe('skipped_disabled')
    // Nothing recalls or learns on its own anymore, so these stay absent.
    expect(t).not.toHaveProperty('recalledCount')
    expect(t).not.toHaveProperty('recallOutcome')
    expect(t).not.toHaveProperty('deliveryMode')
    expect(t).not.toHaveProperty('distill')
  })

  test('superseding a fetched memory records the correction and sinks its tier', async () => {
    // The typical correction flow: agent loads a memory → notices it is wrong
    // → saves a replacement with supersedes. One row, both signals, and the
    // negative wins the tier (A4③ precedence: supersede beats fetch).
    await captureTurnAttribution({
      ...baseTurn,
      fetchedTeamIds: [],
      fetchedPersonalIds: ['r1'],
      supersededPersonalIds: ['r1'],
    })
    expect(rows()).toHaveLength(1)
    const r1 = rows()[0]!

    expect(r1.tier).toBe('not_applicable')
    expect((r1.signals as { signal: string }[]).map((s) => s.signal).sort(byCodeUnit)).toEqual([
      'fetch_log',
      'supersede_correction',
    ])
  })

  test('provider defaults to native; an explicit provider stamps rows AND the turn row', async () => {
    await captureTurnAttribution({ ...baseTurn, fetchedTeamIds: ['g1'], fetchedPersonalIds: [] })
    expect(rows()[0]!.provider).toBe('native')
    expect(turns()[0]!.provider).toBe('native')

    // The runtime stamps the RESOLVED provider at the call boundary
    // (decision 3 — a bare id without its provider tag is meaningless).
    await captureTurnAttribution({
      ...baseTurn,
      conversationId: 'sess-2',
      provider: 'vendor-x',
      fetchedTeamIds: ['g9'],
      fetchedPersonalIds: [],
    })
    const vendorRow = rows().find((r) => r.memoryId === 'g9')!

    expect(vendorRow.provider).toBe('vendor-x')
    expect(turns().find((t) => t.conversationId === 'sess-2')!.provider).toBe('vendor-x')
  })

  test('a turn without fetches writes the denominator row but no attribution rows', async () => {
    await captureTurnAttribution({ ...baseTurn, fetchedTeamIds: [], fetchedPersonalIds: [] })
    expect(rows()).toHaveLength(0)
    expect(turns()).toHaveLength(1)
  })
})
