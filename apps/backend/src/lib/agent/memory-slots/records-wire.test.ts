// Phase 2 PR 2 (B): wire parity for the /memories* records swap. The legacy
// routes returned the records-api result VERBATIM (list page / item / {ok}),
// so with records-api doubled the fixture itself IS the captured legacy body.
// Contract under test: the SPI round-trip (records-api item → native adapter
// MemoryRecordItem → wire spread) reproduces that body exactly, plus ONLY the
// sanctioned additive fields — top-level `provider`, per-item `kind`, and the
// `playbook` dual-emit of `gene` during the rename window. DELETE forwards the
// human reason verbatim: redaction/capping stays store-side (single-redaction
// invariant — deleteMemoryItem already does it).

import { describe, expect, test } from 'bun:test'

import { useMemoryRecordsApi } from '@/lib/test/doubles/memory-records-api'

import type {
  deleteMemoryItem,
  getMemoryItem,
  listMemoryItems,
  MemoryListItem,
  MemoryListPage,
  restoreMemoryItem,
} from '@/lib/agent/memory-native/records-api'

// ── Mutable impls behind the one process-wide double registration ───────────
let listImpl: typeof listMemoryItems = async (..._args) => {
  throw new Error('listMemoryItems not stubbed')
}
let getImpl: typeof getMemoryItem = async (..._args) => null
let deleteImpl: typeof deleteMemoryItem = async (..._args) => false
let restoreImpl: typeof restoreMemoryItem = async (..._args) => false

useMemoryRecordsApi({
  listMemoryItems: (...args) => listImpl(...args),
  getMemoryItem: (...args) => getImpl(...args),
  deleteMemoryItem: (...args) => deleteImpl(...args),
  restoreMemoryItem: (...args) => restoreImpl(...args),
})

const { deleteMemoryWire, getMemoryWire, listMemoriesWire, restoreMemoryWire, toWireMemoryItem } =
  await import('./records-wire')

// ── Fixtures: exactly what records-api serves today ─────────────────────────

const flatItem: MemoryListItem = {
  id: '665f1e9caf9f1e0012345601',
  type: 'fact',
  title: 'Staging cluster location',
  text: 'The staging cluster lives in fra1.',
  categories: ['infra'],
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  convId: 'conv-1',
  userId: 'u1',
  appId: null,
  groupIds: [],
}

const playbookGene = {
  title: 'OOMKilled pods',
  triggerSignals: ['exit code 137', 'restart loop'],
  investigationPath: [{ action: 'describe pod', check: 'lastState exit code 137?' }],
  traps: ['raising limits without measuring'],
  doNotUseWhen: ['node-level memory pressure'],
  status: 'active',
  revision: 2,
}

const playbookItem: MemoryListItem = {
  id: '665f1e9caf9f1e0012345602',
  type: 'artifact',
  text: 'OOMKilled pods\n\nSignals: exit code 137, restart loop\nInvestigation path:\n1. describe pod — lastState exit code 137?',
  categories: [],
  createdAt: '2026-06-20T08:00:00.000Z',
  updatedAt: '2026-07-02T09:30:00.000Z',
  convId: 'conv-2',
  userId: 'u2',
  appId: null,
  groupIds: [],
  gene: playbookGene,
}

const removedItem: MemoryListItem = {
  ...flatItem,
  id: '665f1e9caf9f1e0012345603',
  disabledAt: '2026-07-10T12:00:00.000Z',
  disabledBy: 'u1',
  disabledReason: 'stale after the fra1 migration',
}

const viewer = { userId: 'u1', teamId: 't1', scope: 'team' as const }

// The sanctioned additive projection of a legacy item: per-item `kind`, plus
// the `playbook` dual-emit riding next to `gene`.
const wireOf = (item: MemoryListItem) => ({
  ...item,
  kind: item.gene ? 'playbook' : 'record',
  ...(item.gene ? { playbook: item.gene } : {}),
})

describe('GET /memories parity (listMemoriesWire)', () => {
  test('live listing: byte-parity plus provider/kind/playbook only', async () => {
    const page: MemoryListPage = {
      enabled: true,
      memories: [playbookItem, flatItem],
      nextCursor: 'CURSOR-1',
      hasMore: true,
    }
    let captured: { userId: string; opts: Parameters<typeof listMemoryItems>[1] } | null = null

    listImpl = async (userId, opts) => {
      captured = { userId, opts }

      return page
    }
    const body = await listMemoriesWire(viewer, { cursor: 'CURSOR-0', limit: 25 })

    expect(body).toEqual({
      enabled: true,
      memories: [wireOf(playbookItem), wireOf(flatItem)],
      nextCursor: 'CURSOR-1',
      hasMore: true,
      provider: 'native',
    })
    // The store still receives exactly the legacy arguments.
    expect(captured!.userId).toBe('u1')
    expect(captured!.opts).toMatchObject({
      cursor: 'CURSOR-0',
      limit: 25,
      teamId: 't1',
      scope: 'team',
    })
    expect(captured!.opts?.state ?? 'live').toBe('live')
  })

  test('state=removed listing keeps tombstone fields and the extra-borne disabledReason', async () => {
    let capturedState: string | undefined

    listImpl = async (_userId, opts) => {
      capturedState = opts?.state

      return { enabled: true, memories: [removedItem], nextCursor: null, hasMore: false }
    }
    const body = await listMemoriesWire(
      { userId: 'u1', teamId: null, scope: 'personal' },
      { state: 'removed' },
    )

    expect(capturedState).toBe('removed')
    expect(body).toEqual({
      enabled: true,
      memories: [wireOf(removedItem)],
      nextCursor: null,
      hasMore: false,
      provider: 'native',
    })
  })

  test('absent limit clamps to the legacy default of 50', async () => {
    let capturedLimit: number | undefined

    listImpl = async (_userId, opts) => {
      capturedLimit = opts?.limit

      return { enabled: true, memories: [], nextCursor: null, hasMore: false }
    }
    await listMemoriesWire(viewer, {})
    expect(capturedLimit).toBe(50)
  })
})

describe('GET /memories/:memoryId parity (getMemoryWire)', () => {
  test('playbook detail: byte-parity plus provider/kind/playbook only', async () => {
    const detail: MemoryListItem = {
      ...playbookItem,
      gene: {
        ...playbookGene,
        capsules: [
          {
            outcome: 'success',
            problem: 'api pod restart loop',
            actions: ['raised memory limit to 512Mi'],
            verification: ['no restarts for 24h'],
            conversationId: 'conv-2',
            observedAt: '2026-07-02T09:30:00.000Z',
          },
        ],
      },
    }
    let captured: unknown[] = []

    getImpl = async (...args) => {
      captured = args

      return detail
    }
    const body = await getMemoryWire(viewer, detail.id)

    expect(body).toEqual({
      provider: 'native',
      item: { ...wireOf(detail), playbook: detail.gene, provider: 'native' },
    })
    expect(captured).toEqual(['u1', detail.id, { teamId: 't1', scope: 'team' }])
  })

  test('flat record detail carries kind:"record" and no playbook alias', async () => {
    getImpl = async () => flatItem
    const body = await getMemoryWire(viewer, flatItem.id)

    expect(body).toEqual({
      provider: 'native',
      item: { ...flatItem, kind: 'record', provider: 'native' },
    })
  })

  test('miss → item:null under a resolved provider (route 404s, NOT 5xx)', async () => {
    getImpl = async () => null
    expect(await getMemoryWire(viewer, '665f1e9caf9f1e00123456ff')).toEqual({
      provider: 'native',
      item: null,
    })
  })
})

describe('DELETE /memories/:memoryId parity (deleteMemoryWire)', () => {
  test('forwards the reason VERBATIM — redaction/capping stays store-side (no double redaction)', async () => {
    const rawReason = 'contains AKIAIOSFODNN7EXAMPLE and is wrong'
    let captured: unknown[] = []

    deleteImpl = async (...args) => {
      captured = args

      return true
    }
    const body = await deleteMemoryWire(viewer, flatItem.id, rawReason)

    expect(body).toEqual({ ok: true, supported: true, provider: 'native' })
    // The store receives the untouched reason: deleteMemoryItem is the single
    // redaction point today, and the SPI forwards, never pre-redacts.
    expect(captured).toEqual([
      'u1',
      flatItem.id,
      { teamId: 't1', scope: 'team', reason: rawReason },
    ])
  })

  test('absent reason is absent downstream too', async () => {
    let capturedOpts: Parameters<typeof deleteMemoryItem>[2] | undefined

    deleteImpl = async (_u, _id, opts) => {
      capturedOpts = opts

      return true
    }
    await deleteMemoryWire(viewer, flatItem.id)
    expect(capturedOpts?.reason).toBeUndefined()
  })

  test('miss stays a miss (route 404s on ok:false)', async () => {
    deleteImpl = async () => false
    expect(await deleteMemoryWire(viewer, flatItem.id)).toEqual({
      ok: false,
      supported: true,
      provider: 'native',
    })
  })
})

describe('POST /memories/:memoryId/restore parity (restoreMemoryWire)', () => {
  test('hit → {ok:true} with the provider stamp; store gets the legacy arguments', async () => {
    let captured: unknown[] = []

    restoreImpl = async (...args) => {
      captured = args

      return true
    }
    const body = await restoreMemoryWire(
      { userId: 'u1', teamId: null, scope: 'personal' },
      removedItem.id,
    )

    expect(body).toEqual({ ok: true, supported: true, provider: 'native' })
    expect(captured).toEqual(['u1', removedItem.id, { teamId: undefined, scope: 'personal' }])
  })

  test('miss stays a miss (route 404s on ok:false)', async () => {
    restoreImpl = async () => false
    expect(await restoreMemoryWire(viewer, removedItem.id)).toEqual({
      ok: false,
      supported: true,
      provider: 'native',
    })
  })
})

describe('toWireMemoryItem shadow guard', () => {
  test('an extra key colliding with a core field is dropped, never shadows', () => {
    const wire = toWireMemoryItem(
      {
        id: 'x',
        kind: 'record',
        text: 'core text',
        categories: [],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        convId: null,
        userId: null,
        appId: null,
        groupIds: [],
        extra: { text: 'EVIL OVERWRITE', vendorField: 'kept' },
      },
      'native',
    )

    expect(wire.text).toBe('core text')
    expect(wire.vendorField).toBe('kept')
  })
})
