// T3: native adapter behind the SPI. Real memory-native flows run against an
// in-memory Mongo stand-in (same approach as memory-native.test.ts /
// attribution-store.test.ts); identity is module-mocked. The
// adapter's contract under test: full delegation, and the internal 'gene'
// vocabulary NEVER crossing the SPI boundary.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import * as configActual from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type {
  MemoryFetchedEvent,
  MemoryObserver,
  MemorySavedEvent,
  MemorySearchedEvent,
  MemoryToolContext,
  MemoryViewer,
} from './types'
import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// ── Config: mutable agent overrides behind a frozen-config facade ──────────
// Snapshot the REAL values eagerly: configActual is a live binding that points
// at the mock once installed — referencing it inside the getter would recurse.
// Eager namespace snapshots for post-suite restore: once mock.module installs,
// the `*Actual` live bindings point AT the mock — spreading them later would
// re-capture the mock. bun runs every test file in one process, so a mock of
// a shared module (config) leaks into files that need the real one.
// afterAll below re-mocks each specifier with these
// snapshots to undo the pollution.
const configModuleSnapshot = { ...configActual }

afterAll(async () => {
  await mock.module('@/config', () => configModuleSnapshot)
})
const realAgent = { ...configActual.config.agent }
const realConfig = { ...configActual.config }
const agentOverrides: Record<string, unknown> = {}

await mock.module('@/config', () => ({
  ...configActual,
  config: {
    ...realConfig,
    get agent() {
      return { ...realAgent, ...agentOverrides }
    },
  },
}))

// ── Identity: mutable membership role ──────────────────────────────────────
let membershipRole: 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER' | null = 'EDITOR'

useIdentity({
  getTeamMembership: (async () =>
    membershipRole
      ? { role: membershipRole, team: { id: TEAM, name: 'SPI Team' } }
      : null) as unknown as typeof identityActual.getTeamMembership,
})

// ── Mongo stand-in (memory-native.test.ts pattern, extended with the query
// surface the index/list/search paths use: sort/limit/project/countDocuments,
// $in/$exists/$lt/$or/$all and a substring $text) ───────────────────────────

type FakeDoc = Record<string, unknown>

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
    return this.docs.find((d) => matchesFilter(d, filter)) ?? null
  }
  find(filter: FakeDoc, _options?: unknown) {
    return new FakeCursor(this.docs.filter((d) => matchesFilter(d, filter)))
  }
  async countDocuments(filter: FakeDoc = {}) {
    return this.docs.filter((d) => matchesFilter(d, filter)).length
  }
  async insertOne(doc: FakeDoc) {
    this.docs.push(doc)

    return { insertedId: doc._id }
  }
  async updateOne(
    filter: FakeDoc,
    update: { $set?: FakeDoc; $unset?: FakeDoc; $setOnInsert?: FakeDoc },
    options?: { upsert?: boolean },
  ) {
    const doc = this.docs.find((d) => matchesFilter(d, filter))

    if (doc) {
      applyUpdate(doc, update)

      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
    }
    if (options?.upsert) {
      this.docs.push({ ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) })

      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
    }

    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
  }
  async updateMany(filter: FakeDoc, update: { $set?: FakeDoc; $inc?: Record<string, number> }) {
    const hits = this.docs.filter((d) => matchesFilter(d, filter))

    for (const doc of hits) applyUpdate(doc, update)

    return { matchedCount: hits.length, modifiedCount: hits.length }
  }
  async findOneAndUpdate(filter: FakeDoc, update: { $set?: FakeDoc; $unset?: FakeDoc }) {
    const doc = this.docs.find((d) => matchesFilter(d, filter))

    if (!doc) return null
    const before = { ...doc }

    applyUpdate(doc, update)

    return before
  }
  async createIndex() {
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

// Dynamic import AFTER the mocks: static imports are hoisted, so a static
// './native' here could evaluate before mock.module() runs — dynamic import
// makes the ordering deterministic instead of relying on bun registry
// patching.
const { nativeMemoryProvider } = await import('./native')

const TEAM = 'team-spi-1'
const USER = 'u-spi-1'
const CONV = 'conv-spi-1'

const seedPlaybook = (over: FakeDoc = {}): ObjectId => {
  const _id = new ObjectId()

  fakeCollection('agent_team_memories').docs.push({
    _id,
    teamId: TEAM,
    lineageId: _id.toHexString(),
    status: 'active',
    revision: 1,
    gene: {
      title: 'Pod OOM triage',
      triggerSignals: ['oom', '137'],
      investigationPath: [{ action: 'describe pod', check: 'exit code 137?' }],
      traps: [],
      doNotUseWhen: [],
    },
    capsules: [
      {
        outcome: 'confirmed',
        problem: 'pod restarts',
        actions: ['raised memory limit'],
        verification: ['no restarts for 1h'],
        conversationId: CONV,
        toolCallIds: [],
        authorUserId: USER,
        observedAt: new Date('2026-07-01T00:00:00Z'),
      },
    ],
    createdBy: USER,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedBy: USER,
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
  })

  return _id
}

const seedRecord = (over: FakeDoc = {}): ObjectId => {
  const _id = new ObjectId()

  fakeCollection('agent_memories').docs.push({
    _id,
    scope: 'personal',
    ownerUserId: USER,
    teamId: TEAM,
    type: 'fact',
    text: 'Prefers kubectl over dashboard',
    title: 'kubectl preference',
    categories: [],
    source: 'save_memory',
    conversationId: CONV,
    textHash: `hash-${_id.toHexString()}`,
    createdAt: new Date('2026-07-02T00:00:00Z'),
    updatedAt: new Date('2026-07-02T00:00:00Z'),
    ...over,
  })

  return _id
}

type ObservedEvents = {
  saved: MemorySavedEvent[]
  fetched: MemoryFetchedEvent[]
  searched: MemorySearchedEvent[]
}

const makeObserver = (): { observer: MemoryObserver; events: ObservedEvents } => {
  const events: ObservedEvents = { saved: [], fetched: [], searched: [] }

  return {
    observer: {
      saved: (e) => events.saved.push(e),
      fetched: (e) => events.fetched.push(e),
      searched: (e) => events.searched.push(e),
    },
    events,
  }
}

const toolCtx = (
  observer: MemoryObserver,
  origin: MemoryToolContext['origin'] = 'user',
): MemoryToolContext => ({
  userId: USER,
  teamId: TEAM,
  conversationId: CONV,
  origin,
  observer,
  getActivePlanId: async () => null,
})

const viewer = (scope: MemoryViewer['scope'], teamId: string | null = TEAM): MemoryViewer => ({
  userId: USER,
  teamId,
  scope,
})

// 'gene' must never cross the SPI boundary in vocabulary positions (kind
// fields). It may legitimately appear INSIDE opaque payloads (extra.gene is
// the byte-compat wire field; playbook text bodies may mention anything).
const kindsOf = (events: ObservedEvents): string[] =>
  [
    ...events.saved.map((e) => e.kind),
    ...events.fetched.map((e) => e.kind),
    ...events.searched.flatMap((e) => Object.keys(e.hitsByKind ?? {})),
  ].filter((k): k is string => k !== undefined)

beforeEach(() => {
  fakeCollections.forEach((c) => {
    c.docs = []
  })
  membershipRole = 'EDITOR'
  for (const key of Object.keys(agentOverrides)) delete agentOverrides[key]
  agentOverrides.memoryRerankEnabled = false
})

describe('provider surface', () => {
  test('meta, prefix, storage descriptor, availability, capability absences', async () => {
    expect(nativeMemoryProvider.meta).toEqual({
      id: 'native',
      displayName: 'Nuphos Memory',
      dataResidency: 'local',
      spiVersion: 1,
    })
    expect(nativeMemoryProvider.collectionPrefix).toBe('memory_native_')
    expect(nativeMemoryProvider.storageDescriptor?.()).toEqual({
      kind: 'mongo',
      collections: ['agent_team_memories', 'agent_team_memory_proposals', 'agent_memories'],
    })
    expect(await nativeMemoryProvider.availability({ teamId: null })).toEqual({ state: 'ready' })
    expect(await nativeMemoryProvider.availability({ teamId: TEAM })).toEqual({ state: 'ready' })
    expect(nativeMemoryProvider.feedback).toBeUndefined()
    expect(nativeMemoryProvider).not.toHaveProperty('recall')
    expect(nativeMemoryProvider).not.toHaveProperty('ingest')
    expect(nativeMemoryProvider).not.toHaveProperty('purgeUser')
    expect(nativeMemoryProvider).not.toHaveProperty('purgeTeam')
    expect(nativeMemoryProvider.records?.cursorTier).toBe('strict')
  })

  test('setup() delegates to the native index builder and is idempotent', async () => {
    await nativeMemoryProvider.setup()
    await nativeMemoryProvider.setup()
  })
})

describe('tools.create observer bridging', () => {
  test('personal save → saved event (created, kind record)', async () => {
    const { observer, events } = makeObserver()
    const tools = nativeMemoryProvider.tools!.create(toolCtx(observer)) as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<{ ok: boolean; memoryId?: string }> }
    >
    const result = await tools.save_memory!.execute({
      label: 'save',
      scope: 'personal',
      text: 'Always tag releases before deploy',
      title: 'Release tagging',
      keywords: ['release', 'tag'],
      type: 'fact',
      tags: [],
    })

    expect(result.ok).toBe(true)
    // Observers fire through a fail-open async wrapper — let microtasks drain.
    await new Promise((r) => setTimeout(r, 0))
    expect(events.saved).toHaveLength(1)
    expect(events.saved[0]).toMatchObject({
      id: result.memoryId,
      scope: 'personal',
      kind: 'record',
      action: 'created',
    })
    // The REAL one-line label (save_memory mandates title) — a body-prefix
    // fallback here would leak into every semantic-event consumer.
    expect(events.saved[0]!.title).toBe('Release tagging')
    // Semantic events carry the real doc timestamps (Phase 2: the runtime
    // renders the wire frame from THIS event, so they must be present).
    expect(events.saved[0]!.createdAt).toBeTruthy()
    expect(events.saved[0]!.updatedAt).toBeTruthy()
    expect(kindsOf(events)).not.toContain('gene')
  })

  test('team playbook save → saved event (created, kind playbook)', async () => {
    const { observer, events } = makeObserver()
    const tools = nativeMemoryProvider.tools!.create(toolCtx(observer)) as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<{ ok: boolean; memoryId?: string }> }
    >
    const result = await tools.save_memory!.execute({
      label: 'save',
      scope: 'team',
      tags: [],
      gene: {
        title: 'Registry 502 triage',
        triggerSignals: ['502', 'registry'],
        investigationPath: [{ action: 'check ingress', check: '502 from upstream?' }],
        traps: [],
        doNotUseWhen: [],
        evidence: {
          problem: 'pulls failing',
          actions: ['restarted registry'],
          verification: ['pull ok'],
        },
      },
    })

    expect(result.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(events.saved).toHaveLength(1)
    expect(events.saved[0]).toMatchObject({
      id: result.memoryId,
      scope: 'team',
      kind: 'playbook',
      action: 'created',
      type: 'artifact',
    })
    expect(events.saved[0]!.title).toBe('Registry 502 triage')
    expect(events.saved[0]!.createdAt).toBeTruthy()
    expect(events.saved[0]!.updatedAt).toBeTruthy()
    expect(kindsOf(events)).not.toContain('gene')
  })

  test('supersede → standalone saved event with action superseded (ordering not guaranteed)', async () => {
    const { observer, events } = makeObserver()
    const tools = nativeMemoryProvider.tools!.create(toolCtx(observer)) as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<{ ok: boolean; memoryId?: string }> }
    >
    const first = await tools.save_memory!.execute({
      label: 'save',
      scope: 'personal',
      text: 'Deploy window is Tuesday',
      title: 'Deploy window',
      keywords: ['deploy'],
      type: 'fact',
      tags: [],
    })
    const second = await tools.save_memory!.execute({
      label: 'save',
      scope: 'personal',
      text: 'Deploy window is Thursday',
      title: 'Deploy window',
      keywords: ['deploy'],
      type: 'fact',
      tags: [],
      supersedes: first.memoryId,
    })

    expect(second.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    const superseded = events.saved.find((e) => e.action === 'superseded')

    expect(superseded).toBeDefined()
    expect(superseded!.supersededId).toBe(first.memoryId!)
    // Contract: a standalone superseded lifecycle event (successor unknown at
    // emit time) sets id === supersededId — the retired memory is the subject.
    expect(superseded!.id).toBe(first.memoryId!)
    expect(superseded!.scope).toBe('personal')
    const created = events.saved.filter((e) => e.action === 'created')

    expect(created.map((e) => e.id)).toContain(second.memoryId!)
  })

  test('memory_get by id → fetched events with translated kinds', async () => {
    const playbookId = seedPlaybook()
    const recordId = seedRecord()
    const { observer, events } = makeObserver()
    const tools = nativeMemoryProvider.tools!.create(toolCtx(observer)) as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<{ ok: boolean }> }
    >

    await tools.memory_get!.execute({ label: 'get', memoryId: playbookId.toHexString() })
    const recordResult = (await tools.memory_get!.execute({
      label: 'get',
      memoryId: recordId.toHexString(),
    })) as unknown as { ok: boolean; title?: string }

    expect(recordResult.title).toBe('kubectl preference')
    await new Promise((r) => setTimeout(r, 0))
    expect(events.fetched).toHaveLength(2)
    expect(events.fetched[0]).toMatchObject({
      id: playbookId.toHexString(),
      scope: 'team',
      kind: 'playbook',
      // Fetch-time snapshot for the attribution judge (A4①).
      label: 'Pod OOM triage',
    })
    expect(events.fetched[1]).toMatchObject({
      id: recordId.toHexString(),
      scope: 'personal',
      kind: 'record',
      label: 'kubectl preference',
    })
    expect(kindsOf(events)).not.toContain('gene')
  })

  test('memory_get search → searched event with combined hitCount and per-kind breakdown', async () => {
    seedPlaybook()
    seedRecord({ text: 'OOM killer strikes at memory limits', title: 'oom notes' })
    const { observer, events } = makeObserver()
    const tools = nativeMemoryProvider.tools!.create(toolCtx(observer)) as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<{ ok: boolean }> }
    >

    await tools.memory_get!.execute({ label: 'search', query: 'oom' })
    await new Promise((r) => setTimeout(r, 0))
    expect(events.searched).toHaveLength(1)
    expect(events.searched[0]!.hitCount).toBe(2)
    expect(events.searched[0]!.hitsByKind).toEqual({ record: 1, playbook: 1 })
    // Search hits are fetches too — translated, never 'gene'.
    expect(events.fetched.length).toBeGreaterThanOrEqual(1)
    expect(kindsOf(events)).not.toContain('gene')
  })
})

describe('records delegation', () => {
  test('personal list → kind record, type kept as compat alias, no extra', async () => {
    seedRecord({ teamId: null })
    const page = await nativeMemoryProvider.records!.list({
      viewer: viewer('personal', null),
      cursor: null,
      limit: 50,
      state: 'live',
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ kind: 'record', type: 'fact' })
    expect(page.items[0]!.extra).toBeUndefined()
    expect('gene' in page.items[0]!).toBe(false)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  test('team list → playbook items carry kind playbook + dual-emitted extra', async () => {
    seedPlaybook()
    seedRecord({ scope: 'team', ownerUserId: null })
    const page = await nativeMemoryProvider.records!.list({
      viewer: viewer('team'),
      cursor: null,
      limit: 50,
      state: 'live',
    })

    expect(page.items).toHaveLength(2)
    const playbook = page.items.find((i) => i.kind === 'playbook')!
    const flat = page.items.find((i) => i.kind === 'record')!

    expect(playbook.type).toBe('artifact')
    expect(playbook.extra).toBeDefined()
    const extra = playbook.extra as { gene: { title: string }; playbook: { title: string } }

    // Rename-window dual emission: gene (byte-compat) and playbook (new name)
    // reference the same structured payload.
    expect(extra.gene.title).toBe('Pod OOM triage')
    expect(extra.playbook).toEqual(extra.gene)
    // The neutral core itself never grows a top-level gene field.
    expect('gene' in playbook).toBe(false)
    expect(flat.extra).toBeUndefined()
  })

  test('get playbook by id → includes case evidence in extra', async () => {
    const playbookId = seedPlaybook()
    const item = await nativeMemoryProvider.records!.get(playbookId.toHexString(), viewer('team'))

    expect(item).not.toBeNull()
    expect(item!.kind).toBe('playbook')
    const extra = item!.extra as {
      gene: { capsules?: unknown[] }
      playbook: { capsules?: unknown[] }
    }

    expect(extra.gene.capsules).toHaveLength(1)
  })

  test('unknown ids → get null / delete false, never throw', async () => {
    expect(
      await nativeMemoryProvider.records!.get('not-an-id', viewer('personal', null)),
    ).toBeNull()
    expect(
      await nativeMemoryProvider.records!.get(
        new ObjectId().toHexString(),
        viewer('personal', null),
      ),
    ).toBeNull()
    expect(await nativeMemoryProvider.records!.delete!('not-an-id', viewer('personal', null))).toBe(
      false,
    )
  })

  test('delete + restore round-trip (personal tombstone), reason forwarded', async () => {
    const id = seedRecord({ teamId: null })
    const v = viewer('personal', null)

    expect(
      await nativeMemoryProvider.records!.delete!(id.toHexString(), v, { reason: 'stale advice' }),
    ).toBe(true)
    expect(fakeCollection('agent_memories').docs[0]!.disabledAt).toBeDefined()
    // SPI opts.reason must reach the store — it is the strongest negative
    // ground truth and the PR 2 route swap depends on this pass-through.
    expect(fakeCollection('agent_memories').docs[0]!.disabledReason).toBe('stale advice')
    expect(await nativeMemoryProvider.records!.get(id.toHexString(), v)).toBeNull()
    const removed = await nativeMemoryProvider.records!.list({
      viewer: v,
      cursor: null,
      limit: 50,
      state: 'removed',
    })

    expect(removed.items).toHaveLength(1)
    expect(removed.items[0]!.disabledAt).toBeDefined()
    expect(await nativeMemoryProvider.records!.restore!(id.toHexString(), v)).toBe(true)
    expect(fakeCollection('agent_memories').docs[0]!.disabledAt).toBeUndefined()
  })

  test('team-scope delete honors the VIEWER read-only gate', async () => {
    membershipRole = 'VIEWER'
    const playbookId = seedPlaybook()

    expect(
      await nativeMemoryProvider.records!.delete!(playbookId.toHexString(), viewer('team')),
    ).toBe(false)
  })
})
