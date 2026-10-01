// T1 guard: the SPI type surface compiles against realistic provider literals
// and the version constant anchors the conformance banner. These literals are
// COMPILE-CHECKED contracts — a breaking change to types.ts fails here first.

import { describe, expect, test } from 'bun:test'

import { MEMORY_SPI_VERSION } from './types'

import type {
  AttributionTier,
  IngestOutcome,
  MemoryFetchedEvent,
  MemoryProvider,
  MemoryRecordItem,
  MemorySavedEvent,
  MemorySessionOrigin,
  RenderedMemoryContext,
  TurnDigest,
} from './types'

describe('MEMORY_SPI_VERSION', () => {
  test('is 1', () => {
    expect(MEMORY_SPI_VERSION).toBe(1)
  })
})

describe('provider literals compile against the SPI', () => {
  // Minimal realistic vendor (Mem0/Zep-style shape, spec §b): meta,
  // collectionPrefix, setup, availability + ONE slot. Everything else absent —
  // absence IS the capability signal.
  const minimal: MemoryProvider = {
    meta: {
      id: 'minimal',
      displayName: 'Minimal Vendor',
      vendorName: 'Minimal Inc',
      dataResidency: 'external',
      spiVersion: MEMORY_SPI_VERSION,
    },
    collectionPrefix: 'memory_minimal_',
    setup: async () => {},
    availability: async () => ({ state: 'unconfigured', missing: ['MINIMAL_API_KEY'] }),
    recall: {
      render: async () => null,
    },
  }

  test('minimal provider: only the required surface plus one slot', () => {
    expect(minimal.meta.spiVersion).toBe(MEMORY_SPI_VERSION)
    expect(minimal.tools).toBeUndefined()
    expect(minimal.ingest).toBeUndefined()
    expect(minimal.records).toBeUndefined()
    expect(minimal.feedback).toBeUndefined()
    expect(minimal.webhook).toBeUndefined()
    expect(minimal).not.toHaveProperty('purgeUser')
    expect(minimal).not.toHaveProperty('purgeTeam')
    expect(minimal).not.toHaveProperty('storageDescriptor')
    expect(minimal.availabilityCacheTtlMs).toBeUndefined()
  })

  // Full-slot literal exercising EVERY amended field (A5/A6 folds):
  // budgetMs, placement, kind-primary/type-alias, IngestOutcome status +
  // diagnostics, webhook, cursorTier, optional delete/restore, action
  // 'deleted' with scope omitted, storageDescriptor, availabilityCacheTtlMs,
  // purgeUser/purgeTeam.
  const deletedEvent: MemorySavedEvent = {
    id: 'm-old',
    // scope omitted: optional-with-default on degraded hydration paths (A5⑨)
    kind: 'playbook',
    title: 'vendor-autonomous removal',
    action: 'deleted',
  }

  const rendered: RenderedMemoryContext = {
    block: '## Memories\n- m1 — a fact',
    recalled: [
      { id: 'm1', scope: 'team', kind: 'playbook', label: 'a fact', snippet: 'a fact, expanded' },
    ],
    diagnostics: { teamTotal: 3, cacheState: 'warm', degraded: false },
    placement: 'user-message-tail',
  }

  const pendingOutcome: IngestOutcome = {
    saved: [deletedEvent],
    status: 'pending',
    diagnostics: { vendorJobId: 'job-1', queued: true, attempts: 1 },
  }

  const record: MemoryRecordItem = {
    id: 'm1',
    kind: 'playbook',
    type: 'artifact',
    text: 'body',
    categories: [],
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    convId: null,
    userId: 'u1',
    appId: null,
    groupIds: [],
    extra: { gene: { title: 'x' }, playbook: { title: 'x' } },
  }

  const full: MemoryProvider = {
    meta: {
      id: 'full',
      displayName: 'Full Slot Provider',
      dataResidency: 'local',
      spiVersion: MEMORY_SPI_VERSION,
    },
    collectionPrefix: 'memory_full_',
    setup: async () => {},
    availability: async () => ({ state: 'ready' }),
    availabilityCacheTtlMs: 60_000,
    storageDescriptor: () => ({ kind: 'mongo', collections: ['memory_full_items'] }),
    recall: {
      budgetMs: 10_000,
      render: async () => rendered,
    },
    tools: {
      create: () => ({}),
    },
    ingest: {
      onTurnFinished: async () => pendingOutcome,
    },
    webhook: {
      path: '/webhooks/memory/full',
      verifySignature: ({ headers }) => headers['x-signature'] !== undefined,
      handle: async () => ({ saved: [], status: 'completed' }),
    },
    records: {
      cursorTier: 'best-effort',
      list: async () => ({ items: [record], nextCursor: null, hasMore: false }),
      get: async () => record,
      delete: async () => true,
      restore: async () => true,
      // delete/restore stay OPTIONAL (A5①): a read-only surface is legal.
    },
    feedback: {
      onAttribution: async () => {},
    },
    purgeUser: async () => {},
    purgeTeam: async () => {},
  }

  test('full provider: every amended field is expressible', async () => {
    expect(full.records?.cursorTier).toBe('best-effort')
    expect(full.recall?.budgetMs).toBe(10_000)
    expect(full.availabilityCacheTtlMs).toBe(60_000)
    expect(full.storageDescriptor?.()).toEqual({
      kind: 'mongo',
      collections: ['memory_full_items'],
    })
    const outcome = await full.ingest!.onTurnFinished(
      {
        conversationId: 'c1',
        userId: 'u1',
        teamId: null,
        origin: 'user',
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: 'a',
            toolCalls: [{ id: 't1', name: 'x', arguments: '{}' }],
          },
          { role: 'tool', toolCallId: 't1', content: 'ok' },
        ],
        planId: null,
        startedAt: '2026-07-25T00:00:00.000Z',
        finishedAt: '2026-07-25T00:00:01.000Z',
      },
      { signal: new AbortController().signal },
    )

    expect(outcome?.status).toBe('pending')
    expect(outcome?.saved[0]?.action).toBe('deleted')
    expect(outcome?.saved[0]?.scope).toBeUndefined()
  })

  test('read-only records surface compiles (delete/restore optional per A5①)', () => {
    const readOnly: MemoryProvider = {
      ...minimal,
      meta: { ...minimal.meta, id: 'readonly', dataResidency: 'local' },
      collectionPrefix: 'memory_readonly_',
      records: {
        cursorTier: 'strict',
        list: async () => ({ items: [], nextCursor: null, hasMore: false }),
        get: async () => null,
      },
    }

    expect(readOnly.records).not.toHaveProperty('delete')
    expect(readOnly.records).not.toHaveProperty('restore')
  })

  test('session origin covers the shipped AgentSessionOrigin union', () => {
    // Keyed record: adding a member to MemorySessionOrigin fails compilation
    // here (a plain array would keep passing regardless).
    const all: Record<MemorySessionOrigin, true> = {
      user: true,
      trigger: true,
    }

    expect(Object.keys(all)).toHaveLength(2)
  })

  test('attribution tier covers the shipped AttributionTier union', () => {
    // Keyed record: adding a tier to AttributionTier fails compilation here
    // (the old `satisfies` inside onAttribution only caught widening).
    const all: Record<AttributionTier, true> = {
      recalled: true,
      fetched: true,
      considered: true,
      applied: true,
      not_applicable: true,
    }

    expect(Object.keys(all)).toHaveLength(5)
  })

  test('Phase 2 additive fields compile: saved timestamps, fetched label, delete reason, alreadyRecalled', async () => {
    // MemorySavedEvent carries real doc timestamps — the republished-playbook
    // path has createdAt ≠ updatedAt, so a runtime "now" stamp would lie.
    const timestamped: MemorySavedEvent = {
      id: 'm-republished',
      scope: 'team',
      kind: 'playbook',
      title: 'republished playbook',
      action: 'created',
      type: 'artifact',
      text: 'body',
      categories: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    }

    expect(timestamped.createdAt).not.toBe(timestamped.updatedAt)

    // Fetch-time label: the attribution judge's candidate content snapshot.
    const fetched: MemoryFetchedEvent = {
      id: 'm1',
      scope: 'team',
      kind: 'playbook',
      label: 'OOM triage',
    }

    expect(fetched.label).toBe('OOM triage')

    // delete() accepts the human removal reason; two-arg callers stay legal.
    const viewer = { userId: 'u1', teamId: null, scope: 'personal' as const }

    expect(
      await full.records!.delete!('m1', viewer, { reason: 'outdated after the migration' }),
    ).toBe(true)
    expect(await full.records!.delete!('m1', viewer)).toBe(true)

    // alreadyRecalled: the distiller's dedup hint, populated by the runtime.
    const digest: TurnDigest = {
      conversationId: 'c1',
      userId: 'u1',
      teamId: null,
      origin: 'user',
      messages: [{ role: 'user', content: 'q' }],
      planId: null,
      startedAt: '2026-07-25T00:00:00.000Z',
      finishedAt: '2026-07-25T00:00:01.000Z',
      alreadyRecalled: ['OOM triage', 'kubectl preference'],
    }

    expect(digest.alreadyRecalled).toHaveLength(2)
  })

  test('file-backed storage descriptor is expressible (A5⑧)', () => {
    const descriptor: NonNullable<MemoryProvider['storageDescriptor']> = () => ({
      kind: 'file',
      paths: ['/var/lib/memory/markdown'],
    })

    expect(descriptor().kind).toBe('file')
  })
})
