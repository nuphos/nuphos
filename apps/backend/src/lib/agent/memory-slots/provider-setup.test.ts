// Phase 2 PR 2 (A): the per-provider setup loop that replaces the models index
// table's direct ['memory-native', setupTeamMemoryIndexes] entry. Under test:
// a throwing provider.setup() marks THAT provider {state:'error'} and never
// fails the overall setup (boot continues), native's real indexes still get
// created through the loop, and the runtime-owned ingest-event indexes are
// wired into the models index table alongside memory-attribution.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'bun:test'
import { MongoServerError } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import { MEMORY_SPI_VERSION } from './types'

import {
  providerAvailability,
  resetMemoryProviderSetupState,
  runMemoryProviderSetup,
} from './index'

import type { MemoryProvider } from './types'
import type * as dbActual from '@/lib/db'

// ── Mongo stand-in: records createIndex calls per collection ────────────────
class Fake {
  createdIndexes: unknown[] = []
  async createIndex(spec: unknown) {
    this.createdIndexes.push(spec)

    return ''
  }
  async dropIndex() {
    return {}
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

const makeProvider = (
  id: string,
  over: Partial<Pick<MemoryProvider, 'setup' | 'availability'>> = {},
): MemoryProvider => ({
  meta: {
    id,
    displayName: `Provider ${id}`,
    dataResidency: 'local',
    spiVersion: MEMORY_SPI_VERSION,
  },
  collectionPrefix: `memory_${id}_`,
  setup: over.setup ?? (async () => {}),
  availability: over.availability ?? (async () => ({ state: 'ready' })),
  recall: { render: async () => null },
})

describe('runMemoryProviderSetup', () => {
  beforeEach(() => {
    resetMemoryProviderSetupState()
    byName.clear()
  })

  test('a throwing setup() never fails the overall setup and marks that provider error', async () => {
    let okRan = false
    const broken = makeProvider('broken', {
      setup: async () => {
        throw new Error('boom: index build exploded')
      },
    })
    const ok = makeProvider('ok', {
      setup: async () => {
        okRan = true
      },
    })

    await expect(runMemoryProviderSetup([broken, ok])).resolves.toBeUndefined()
    expect(okRan).toBe(true)
    const brokenState = await providerAvailability(broken, { teamId: null })

    expect(brokenState.state).toBe('error')
    expect(brokenState.state === 'error' && brokenState.reason).toContain('boom')
    expect(await providerAvailability(ok, { teamId: null })).toEqual({ state: 'ready' })
  })

  test('a Mongo 85/86 index conflict is tolerated, not an error state (models.ts parity)', async () => {
    const conflicted = makeProvider('conflicted', {
      setup: async () => {
        const err = new MongoServerError({ message: 'index exists with different spec' })

        err.code = 85
        throw err
      },
    })

    await runMemoryProviderSetup([conflicted])
    expect(await providerAvailability(conflicted, { teamId: null })).toEqual({ state: 'ready' })
  })

  test('a later successful setup clears a previous failure (idempotent recovery)', async () => {
    let attempts = 0
    const flaky = makeProvider('flaky', {
      setup: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('transient')
      },
    })

    await runMemoryProviderSetup([flaky])
    expect((await providerAvailability(flaky, { teamId: null })).state).toBe('error')
    await runMemoryProviderSetup([flaky])
    expect(await providerAvailability(flaky, { teamId: null })).toEqual({ state: 'ready' })
  })

  test("default run covers the real registry: native's indexes are created", async () => {
    await runMemoryProviderSetup()
    // setupTeamMemoryIndexes touches all three native stores.
    expect(coll('agent_team_memories').createdIndexes.length).toBeGreaterThan(0)
    expect(coll('agent_team_memory_proposals').createdIndexes.length).toBeGreaterThan(0)
    expect(coll('agent_memories').createdIndexes.length).toBeGreaterThan(0)
  })
})

describe('providerAvailability', () => {
  beforeEach(() => resetMemoryProviderSetupState())

  test('a throwing availability() is coerced to {state:"error"}', async () => {
    const p = makeProvider('throwy', {
      availability: async () => {
        throw new Error('availability crashed')
      },
    })
    const state = await providerAvailability(p, { teamId: null })

    expect(state.state).toBe('error')
    expect(state.state === 'error' && state.reason).toContain('availability crashed')
  })

  test('a recorded setup failure wins over a ready availability()', async () => {
    const p = makeProvider('half-up', {
      setup: async () => {
        throw new Error('setup died')
      },
    })

    await runMemoryProviderSetup([p])
    const state = await providerAvailability(p, { teamId: null })

    expect(state).toEqual({ state: 'error', reason: expect.stringContaining('setup died') })
  })
})

describe('models/indexes.ts wiring (source-level)', () => {
  // `models.ts` is a barrel of re-exports; the index-group table itself lives
  // in `models/indexes.ts`. Reading the barrel here would make both assertions
  // below pass vacuously against a file that never mentions either symbol.
  const modelsSource = readFileSync(
    join(import.meta.dir, '..', '..', '..', 'models', 'indexes.ts'),
    'utf8',
  )

  test('the provider setup loop replaces the direct memory-native entry', () => {
    expect(modelsSource).toContain("['memory-providers', runMemoryProviderSetup]")
    expect(modelsSource).not.toContain('setupTeamMemoryIndexes')
  })

  test('the runtime-owned ingest-event indexes are wired like memory-attribution', () => {
    expect(modelsSource).toContain("['memory-ingest-events', setupMemoryIngestEventIndexes]")
    expect(modelsSource).toContain("['memory-attribution', setupMemoryAttributionIndexes]")
  })
})
