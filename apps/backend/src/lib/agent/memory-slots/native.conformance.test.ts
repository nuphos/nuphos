// T6: the native adapter runs the EXACT same conformance suite every vendor
// bundle will run (decision 10's acid test). Harness: FakeCollection Mongo
// stand-in (memory-native.test.ts pattern extended with the records-api
// keyset surface), identity/distill module-mocked, recall under
// deliveryMode 'injection'. existsInRealStore reads the fake map directly —
// ground truth bypassing RecordsSurface.

import { afterAll, expect, mock, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import * as configActual from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { useDistill } from '@/lib/test/doubles/distill'
import { useIdentity } from '@/lib/test/doubles/identity'

import { MEMORY_RECORDS_COLLECTION } from '../memory-native/store'

import { describeMemoryProviderConformance } from './conformance'

import type { ConformanceHarness, ConformanceTenant } from './conformance'
import type { MemoryObserver, MemorySessionOrigin } from './types'
import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// ── Config: recall conformance under deliveryMode 'injection' ──────────────
// Eager namespace snapshots for post-suite restore: once mock.module installs,
// the `*Actual` live bindings point AT the mock — spreading them later would
// re-capture the mock. bun runs every test file in one process, so a mock of
// a shared module (config, distill) leaks into files that need the real one
// (distill.test.ts). afterAll below re-mocks each specifier with these
// snapshots to undo the pollution.
const configModuleSnapshot = { ...configActual }

afterAll(async () => {
  await mock.module('@/config', () => configModuleSnapshot)
})
const realAgent = { ...configActual.config.agent }
const realConfig = { ...configActual.config }

await mock.module('@/config', () => ({
  ...configActual,
  config: {
    ...realConfig,
    agent: {
      ...realAgent,
      memoryDeliveryMode: 'injection' as const,
      memoryAutoIngest: true,
      memoryRerankEnabled: false,
      memoryIndexRanking: 'recency' as const,
    },
  },
}))

useIdentity({
  getTeamMembership: (async () => ({
    role: 'EDITOR',
    team: { id: 'conformance-team', name: 'Conformance Team' },
  })) as unknown as typeof identityActual.getTeamMembership,
})

// Fast, deterministic distiller: the ingest conformance items test the
// non-rejection contract, not model behavior.
useDistill({
  distillTurnMemory: async () => ({ outcome: 'no_learn' }),
})

// ── Mongo stand-in with fault injection ─────────────────────────────────────

type FakeDoc = Record<string, unknown>

let faultInjected = false
const maybeFault = () => {
  if (faultInjected) throw new Error('injected store fault (conformance)')
}

function lt(value: unknown, bound: unknown): boolean {
  if (value instanceof Date && bound instanceof Date) return value.getTime() < bound.getTime()
  if (value instanceof ObjectId && bound instanceof ObjectId)
    return value.toHexString() < bound.toHexString()

  return (value as never) < (bound as never)
}

function matchesCond(value: unknown, cond: unknown): boolean {
  if (cond instanceof ObjectId) return value instanceof ObjectId && cond.equals(value)
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime()
  if (cond && typeof cond === 'object') {
    const c = cond as Record<string, unknown>

    if ('$in' in c) return (c.$in as unknown[]).some((v) => matchesCond(value, v))
    if ('$exists' in c) return c.$exists ? value !== undefined : value === undefined
    if ('$lt' in c) return lt(value, c.$lt)
    if ('$all' in c)
      return Array.isArray(value) && (c.$all as unknown[]).every((v) => value.includes(v))
  }

  return value === cond
}

function matchesFilter(doc: FakeDoc, filter: FakeDoc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as FakeDoc[]).some((f) => matchesFilter(doc, f))
    if (key === '$text') {
      const q = ((cond as { $search: string }).$search ?? '').toLowerCase().split(/\s+/)[0] ?? ''

      return JSON.stringify(doc).toLowerCase().includes(q)
    }

    return matchesCond(doc[key], cond)
  })
}

function applyUpdate(
  doc: FakeDoc,
  update: { $set?: FakeDoc; $unset?: FakeDoc; $inc?: Record<string, number> },
): void {
  Object.assign(doc, update.$set ?? {})
  for (const key of Object.keys(update.$unset ?? {})) delete doc[key]
  for (const [key, by] of Object.entries(update.$inc ?? {}))
    doc[key] = ((doc[key] as number) ?? 0) + by
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (a instanceof ObjectId && b instanceof ObjectId)
    return a.toHexString() < b.toHexString() ? -1 : a.toHexString() > b.toHexString() ? 1 : 0
  if (typeof a === 'number' && typeof b === 'number') return a - b

  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

class FakeCursor {
  constructor(private rows: FakeDoc[]) {}
  sort(spec: Record<string, unknown>) {
    const keys = Object.entries(spec).filter(([, dir]) => dir === 1 || dir === -1) as [
      string,
      1 | -1,
    ][]

    this.rows = [...this.rows].sort((a, b) => {
      for (const [key, dir] of keys) {
        const c = compare(a[key], b[key])

        if (c !== 0) return c * dir
      }

      return 0
    })

    return this
  }
  limit(n: number) {
    this.rows = this.rows.slice(0, n)

    return this
  }
  project(_spec: unknown) {
    return this
  }
  async toArray() {
    return this.rows
  }
}

class FakeCollection {
  docs: FakeDoc[] = []
  async findOne(filter: FakeDoc, _options?: unknown): Promise<FakeDoc | null> {
    maybeFault()

    return this.docs.find((d) => matchesFilter(d, filter)) ?? null
  }
  find(filter: FakeDoc, _options?: unknown) {
    maybeFault()

    return new FakeCursor(this.docs.filter((d) => matchesFilter(d, filter)))
  }
  async countDocuments(filter: FakeDoc = {}) {
    maybeFault()

    return this.docs.filter((d) => matchesFilter(d, filter)).length
  }
  async insertOne(doc: FakeDoc) {
    maybeFault()
    this.docs.push(doc)

    return { insertedId: doc._id }
  }
  async updateOne(filter: FakeDoc, update: { $set?: FakeDoc; $unset?: FakeDoc }) {
    maybeFault()
    const doc = this.docs.find((d) => matchesFilter(d, filter))

    if (doc) applyUpdate(doc, update)

    return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 }
  }
  async updateMany(filter: FakeDoc, update: { $set?: FakeDoc; $inc?: Record<string, number> }) {
    maybeFault()
    const hits = this.docs.filter((d) => matchesFilter(d, filter))

    for (const doc of hits) applyUpdate(doc, update)

    return { matchedCount: hits.length, modifiedCount: hits.length }
  }
  async findOneAndUpdate(filter: FakeDoc, update: { $set?: FakeDoc; $unset?: FakeDoc }) {
    maybeFault()
    const doc = this.docs.find((d) => matchesFilter(d, filter))

    if (!doc) return null
    const before = { ...doc }

    applyUpdate(doc, update)

    return before
  }
  async createIndex() {
    return ''
  }
  async dropIndex() {
    return ''
  }
}

const fakeCollections = new Map<string, FakeCollection>()
const fakeCollection = (name: string): FakeCollection => {
  let c = fakeCollections.get(name)

  if (!c) {
    c = new FakeCollection()
    fakeCollections.set(name, c)
  }

  return c
}

useDb({
  db: (() => ({ collection: fakeCollection })) as unknown as typeof dbActual.db,
})

// Dynamic import AFTER the mocks — deterministic ordering (static imports
// hoist above the mock.module calls).
const { nativeMemoryProvider } = await import('./native')

// ── Harness ──────────────────────────────────────────────────────────────────

const noopObserver: MemoryObserver = { saved: () => {}, fetched: () => {}, searched: () => {} }

let seedSerial = 0

const harness: ConformanceHarness = {
  provider: nativeMemoryProvider,
  tenantA: { userId: 'conf-user-a', teamId: 'conf-team-a' },
  tenantB: { userId: 'conf-user-b', teamId: 'conf-team-b' },

  // Natural write path: the provider's own save_memory tool (personal scope).
  async seed(
    tenant: ConformanceTenant,
    input: { text: string; title: string },
    opts?: { origin?: MemorySessionOrigin; observer?: MemoryObserver },
  ): Promise<string | null> {
    const tools = nativeMemoryProvider.tools!.create({
      userId: tenant.userId,
      teamId: tenant.teamId,
      conversationId: `conf-conv-${tenant.userId}`,
      origin: opts?.origin ?? 'user',
      observer: opts?.observer ?? noopObserver,
      getActivePlanId: async () => null,
    }) as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<{ ok: boolean; memoryId?: string }> }
    >
    const result = await tools.save_memory!.execute({
      label: 'conformance seed',
      scope: 'personal',
      text: input.text,
      title: input.title,
      keywords: ['conformance', `k${String(seedSerial++)}`],
      type: 'fact',
      tags: [],
    })

    // Observer sinks fire through a fail-open async wrapper; drain them so
    // corroboration checks see the events.
    await new Promise((r) => setTimeout(r, 0))

    return result.ok && result.memoryId ? result.memoryId : null
  },

  // Ground truth, bypassing RecordsSurface: LIVE in the real store means the
  // doc exists and is not tombstoned out of every live surface.
  async existsInRealStore(id: string): Promise<boolean> {
    return fakeCollection(MEMORY_RECORDS_COLLECTION).docs.some(
      (d) => d._id instanceof ObjectId && d._id.toHexString() === id && d.disabledAt === undefined,
    )
  },

  async withFaultInjection<T>(fn: () => Promise<T>): Promise<T> {
    faultInjected = true
    try {
      return await fn()
    } finally {
      faultInjected = false
    }
  },

  makeTurnDigest(tenant: ConformanceTenant, over = {}) {
    return {
      conversationId: `conf-conv-${tenant.userId}`,
      userId: tenant.userId,
      teamId: tenant.teamId,
      origin: 'user' as const,
      messages: [
        { role: 'user' as const, content: 'conformance turn: canary deploys go first' },
        { role: 'assistant' as const, content: 'Acknowledged — canary first.' },
      ],
      planId: null,
      startedAt: '2026-07-25T00:00:00.000Z',
      finishedAt: '2026-07-25T00:00:05.000Z',
      ...over,
    }
  },

  async cleanup(): Promise<void> {
    faultInjected = false
    fakeCollections.forEach((c) => {
      c.docs = []
    })
  },

  async listStoreCollections(): Promise<string[]> {
    return [...fakeCollections.keys()]
  },
}

test('the suite runs against the native provider with disjoint tenants', () => {
  expect(harness.provider.meta.id).toBe('native')
  expect(harness.tenantA.userId).not.toBe(harness.tenantB.userId)
  expect(harness.tenantA.teamId).not.toBe(harness.tenantB.teamId)
})

describeMemoryProviderConformance(() => harness)
