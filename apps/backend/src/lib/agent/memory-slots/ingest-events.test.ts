// T-Phase2: durable IngestOutcome snapshots (memory_runtime_ingest_events).
// The SSE stream is usually closed by the time a provider's ingest resolves —
// this store is what lets GET /memories/ingest/:sessionId serve learned
// events post-hoc for EVERY provider (route swap is a later PR). Same
// @/lib/db Fake approach as attribution-capture.test.ts.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type * as dbActual from '@/lib/db'

class Fake {
  docs: Record<string, unknown>[] = []
  private m(f: Record<string, unknown>) {
    return this.docs.find((d) => Object.entries(f).every(([k, v]) => d[k] === v))
  }
  async findOne(f: Record<string, unknown>) {
    return this.m(f) ?? null
  }
  find(f: Record<string, unknown>) {
    const rows = this.docs.filter((d) => Object.entries(f).every(([k, v]) => d[k] === v))

    return {
      sort: (spec: Record<string, 1 | -1>) => {
        const [key, dir] = Object.entries(spec)[0]!

        rows.sort((a, b) => {
          const av = a[key] as Date
          const bv = b[key] as Date

          return (av.getTime() - bv.getTime()) * (dir as number)
        })

        return {
          toArray: async () => rows,
          limit: (n: number) => ({ toArray: async () => rows.slice(0, n) }),
        }
      },
      toArray: async () => rows,
    }
  }
  async updateOne(
    f: Record<string, unknown>,
    u: {
      $set?: Record<string, unknown>
      $setOnInsert?: Record<string, unknown>
      $unset?: Record<string, unknown>
    },
    o?: { upsert?: boolean },
  ) {
    const hit = this.m(f)

    if (hit) {
      Object.assign(hit, u.$set ?? {})
      for (const k of Object.keys(u.$unset ?? {})) delete hit[k]

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

useDb({
  db: (() => ({ collection: coll })) as unknown as typeof dbActual.db,
})

const {
  getIngestEventSnapshot,
  listIngestEventSnapshots,
  setupMemoryIngestEventIndexes,
} = await import('./ingest-events')

const rows = () => coll('memory_runtime_ingest_events').docs

// Nothing writes snapshots anymore; rows left by the retired auto-ingest are
// seeded directly, the way they exist in Mongo.
const seed = (over: Record<string, unknown> = {}) => {
  rows().push({
    v: 1,
    provider: 'native',
    teamId: 't1',
    userId: 'u1',
    conversationId: 'sess-1',
    turnKey: 'req-1',
    status: 'completed',
    saved: [],
    at: new Date(),
    ...over,
  })
}

describe('ingest event snapshots', () => {
  beforeEach(() =>
    byName.forEach((c) => {
      c.docs = []
    }),
  )

  test('listIngestEventSnapshots serves only the requested session, oldest first', async () => {
    seed({ turnKey: 'req-2' })
    seed()
    seed({ conversationId: 'sess-OTHER' })
    const listed = await listIngestEventSnapshots('sess-1')

    expect(listed).toHaveLength(2)
    expect(listed.every((s) => s.conversationId === 'sess-1')).toBe(true)
  })

  test('getIngestEventSnapshot addresses one exact turn', async () => {
    seed()
    seed({ turnKey: 'req-2', status: 'pending' })

    expect((await getIngestEventSnapshot('sess-1', 'req-2'))?.status).toBe('pending')
    expect(await getIngestEventSnapshot('sess-1', 'missing')).toBeNull()
    expect(await getIngestEventSnapshot('sess-OTHER', 'req-2')).toBeNull()
  })

  test('setup creates indexes without throwing (idempotent)', async () => {
    await setupMemoryIngestEventIndexes()
    await setupMemoryIngestEventIndexes()
  })
})
