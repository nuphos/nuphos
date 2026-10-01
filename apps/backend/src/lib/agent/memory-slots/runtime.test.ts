// T5: runtime resolution discipline, observer factory, recall budget race.
// Unwired in Phase 1 — Phase 2 swaps the call sites onto these functions.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useObservability } from '@/lib/test/doubles/observability'

import { nativeMemoryProvider } from './native'
import {
  capabilitiesOf,
  createMemoryObserver,
  gateResolutionOnAvailability,
  raceRecallBudget,
  refOf,
  resolveForNewSession,
  resolveForTurn,
  resolveTurnFromStamp,
  resolveTurnProvider,
} from './runtime'

import { resetMemoryProviderSetupState, runMemoryProviderSetup } from './index'

import type { MemoryProvider, RecallInput } from './types'

const errors: { event: string }[] = []

useObservability({
  logError: (event) => {
    errors.push({ event })
  },
})

const RECALL_INPUT: RecallInput = {
  userId: 'u1',
  teamId: null,
  query: 'q',
  conversationId: 'c1',
}

const minimalProvider = (over: Partial<MemoryProvider> = {}): MemoryProvider => ({
  meta: {
    id: 'fake',
    displayName: 'Fake',
    dataResidency: 'local',
    spiVersion: 1,
  },
  collectionPrefix: 'memory_fake_',
  setup: async () => {},
  availability: async () => ({ state: 'ready' }),
  recall: { render: async () => null },
  ...over,
})

describe('resolveForNewSession', () => {
  test('Phase 1: stamps the global default (team override is Phase 3)', () => {
    expect(resolveForNewSession({ teamId: null })).toEqual({ providerId: 'native' })
    expect(resolveForNewSession({ teamId: 'team-1' })).toEqual({ providerId: 'native' })
  })
})

describe('resolveForTurn', () => {
  test('stamped + registered → active with source session', () => {
    const resolution = resolveForTurn({ memoryProvider: 'native' }, { teamId: null })

    expect(resolution.kind).toBe('active')
    if (resolution.kind === 'active') {
      expect(resolution.providerId).toBe('native')
      expect(resolution.source).toBe('session')
      expect(resolution.provider).toBe(nativeMemoryProvider)
    }
  })

  test('stamped + unregistered → disabled, stamp honored absolutely (never re-routed)', () => {
    const resolution = resolveForTurn({ memoryProvider: 'ghost' }, { teamId: 'team-1' })

    expect(resolution).toEqual({ kind: 'disabled', providerId: 'ghost', reason: 'unregistered' })
  })

  test('unstamped legacy session → global default with source global', () => {
    const resolution = resolveForTurn({}, { teamId: 'team-1' })

    expect(resolution.kind).toBe('active')
    if (resolution.kind === 'active') {
      expect(resolution.providerId).toBe('native')
      expect(resolution.source).toBe('global')
    }
  })
})

describe('resolveTurnProvider (Phase 2 chat-path resolver)', () => {
  // The setup-failure cache is process-global — restore it so other suites
  // (and the availability read itself) see a clean slate.
  afterEach(() => resetMemoryProviderSetupState())

  test('ready provider → the resolveForTurn resolution passes through', async () => {
    const resolution = await resolveTurnProvider({ memoryProvider: 'native' }, { teamId: null })

    expect(resolution.kind).toBe('active')
    if (resolution.kind === 'active') {
      expect(resolution.providerId).toBe('native')
      expect(resolution.source).toBe('session')
    }
  })

  test('setup failure → disabled/unavailable, stamped-absolute (never re-routes)', async () => {
    // Poison the setup-state cache for 'native' the way boot would: a
    // provider whose setup() died reports {state:'error'} until re-run.
    await runMemoryProviderSetup([
      {
        ...nativeMemoryProvider,
        setup: async () => {
          throw new Error('index build died')
        },
      },
    ])
    const resolution = await resolveTurnProvider({ memoryProvider: 'native' }, { teamId: 't1' })

    expect(resolution).toEqual({ kind: 'disabled', providerId: 'native', reason: 'unavailable' })
    // The unstamped/global branch degrades identically — no silent fallback.
    const globalResolution = await resolveTurnProvider({}, { teamId: null })

    expect(globalResolution).toEqual({
      kind: 'disabled',
      providerId: 'native',
      reason: 'unavailable',
    })
  })

  test('unregistered stamp stays unregistered (availability never consulted)', async () => {
    const resolution = await resolveTurnProvider({ memoryProvider: 'ghost' }, { teamId: null })

    expect(resolution).toEqual({ kind: 'disabled', providerId: 'ghost', reason: 'unregistered' })
  })

  test('unconfigured availability → disabled/unavailable (not just state:error)', async () => {
    const gated = await gateResolutionOnAvailability(
      {
        kind: 'active',
        provider: {
          ...nativeMemoryProvider,
          availability: async () => ({ state: 'unconfigured', missing: ['VENDOR_API_KEY'] }),
        },
        providerId: 'native',
        source: 'session',
      },
      { teamId: null },
    )

    expect(gated).toEqual({ kind: 'disabled', providerId: 'native', reason: 'unavailable' })
  })

  test('hung availability() trips the budget into a memory-off turn, never a stall', async () => {
    const gated = await gateResolutionOnAvailability(
      {
        kind: 'active',
        provider: {
          ...nativeMemoryProvider,
          availability: () => new Promise(() => {}),
        },
        providerId: 'native',
        source: 'session',
      },
      { teamId: null },
      50,
    )

    expect(gated).toEqual({ kind: 'disabled', providerId: 'native', reason: 'unavailable' })
  })
})

describe('resolveTurnFromStamp (chat-handler stamp-read discipline)', () => {
  beforeEach(() => {
    errors.length = 0
  })

  test('stamped conversation → session resolution, no lazy stamp', async () => {
    const stamps: string[] = []
    const resolution = await resolveTurnFromStamp({
      readStamp: async () => 'native',
      lazyStamp: (providerId) => stamps.push(providerId),
      team: { teamId: null },
    })

    expect(resolution.kind).toBe('active')
    if (resolution.kind === 'active') {
      expect(resolution.providerId).toBe('native')
      expect(resolution.source).toBe('session')
    }
    expect(stamps).toEqual([])
  })

  test('successful read with no stamp (legacy conversation) → global default + lazy stamp fires', async () => {
    const stamps: string[] = []
    const resolution = await resolveTurnFromStamp({
      readStamp: async () => undefined,
      lazyStamp: (providerId) => stamps.push(providerId),
      team: { teamId: 't1' },
    })

    expect(resolution.kind).toBe('active')
    if (resolution.kind === 'active') {
      expect(resolution.source).toBe('global')
      expect(stamps).toEqual([resolution.providerId])
    }
  })

  test('stamp-read failure → memory-off turn (fail closed), no lazy stamp, ops log (zebra F1)', async () => {
    const stamps: string[] = []
    const resolution = await resolveTurnFromStamp({
      readStamp: async () => {
        throw new Error('mongo down')
      },
      lazyStamp: (providerId) => stamps.push(providerId),
      team: { teamId: 't1' },
    })

    // Falling open to the global default here would let a vendor-stamped
    // conversation ingest into the default provider for one turn.
    expect(resolution).toEqual({ kind: 'disabled', providerId: null, reason: 'unavailable' })
    expect(stamps).toEqual([])
    expect(errors.some((e) => e.event === 'agent.memory.stamp_read_error')).toBe(true)
  })
})

describe('createMemoryObserver', () => {
  test('delivers events to sinks', () => {
    const saved: unknown[] = []
    const fetched: unknown[] = []
    const searched: unknown[] = []
    const observer = createMemoryObserver({
      providerId: 'native',
      sinks: {
        saved: (e) => saved.push(e),
        fetched: (e) => fetched.push(e),
        searched: (e) => searched.push(e),
      },
    })

    observer.saved({ id: 'm1', scope: 'personal', title: 't', action: 'created' })
    observer.fetched({ id: 'm1', scope: 'personal' })
    observer.searched({ query: 'q', hitCount: 0 })
    expect(saved).toHaveLength(1)
    expect(fetched).toHaveLength(1)
    expect(searched).toHaveLength(1)
  })

  test('a throwing sink never throws into the provider call', () => {
    const observer = createMemoryObserver({
      providerId: 'native',
      sinks: {
        saved: () => {
          throw new Error('sink exploded')
        },
        fetched: () => {
          throw new Error('sink exploded')
        },
        searched: () => {
          throw new Error('sink exploded')
        },
      },
    })

    expect(() => observer.saved({ id: 'm1', title: 't', action: 'created' })).not.toThrow()
    expect(() => observer.fetched({ id: 'm1', scope: 'team' })).not.toThrow()
    expect(() => observer.searched({ query: 'q', hitCount: 1 })).not.toThrow()
  })

  test('absent sinks are no-ops', () => {
    const observer = createMemoryObserver({ providerId: 'native', sinks: {} })

    expect(() => observer.saved({ id: 'm1', title: 't', action: 'created' })).not.toThrow()
  })
})

describe('raceRecallBudget', () => {
  test('absent recall slot → null', async () => {
    const provider = minimalProvider({ recall: undefined, tools: { create: () => ({}) } })

    expect(await raceRecallBudget(provider, RECALL_INPUT)).toBeNull()
  })

  test('fast success passes the rendered context through', async () => {
    const provider = minimalProvider({
      recall: { render: async () => ({ block: 'B', recalled: [] }) },
    })

    expect(await raceRecallBudget(provider, RECALL_INPUT)).toEqual({ block: 'B', recalled: [] })
  })

  test('throwing render resolves null — never rejects', async () => {
    const provider = minimalProvider({
      recall: {
        render: async () => {
          throw new Error('vendor down')
        },
      },
    })

    await expect(raceRecallBudget(provider, RECALL_INPUT)).resolves.toBeNull()
  })

  test('a hung render is abandoned at the per-provider budget (signal aborted)', async () => {
    let aborted = false
    const provider = minimalProvider({
      recall: {
        budgetMs: 20,
        render: (_input, opts) =>
          // Never resolves. A well-behaved provider resolves on abort; a hung
          // one never does — the race must not care.
          new Promise(() => {
            opts.signal.addEventListener('abort', () => {
              aborted = true
            })
          }),
      },
    })
    const started = Date.now()
    const result = await raceRecallBudget(provider, RECALL_INPUT)

    expect(result).toBeNull()
    expect(aborted).toBe(true)
    // Bounded by the 20ms budget, not the 5s default.
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test('a post-abort rejection is swallowed, not an unhandled rejection', async () => {
    const provider = minimalProvider({
      recall: {
        budgetMs: 10,
        render: (_input, opts) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      },
    })

    await expect(raceRecallBudget(provider, RECALL_INPUT)).resolves.toBeNull()
    // Give the late rejection a tick to fire; the test fails on unhandled
    // rejection if the race did not attach a catch handler.
    await new Promise((r) => setTimeout(r, 20))
  })
})

describe('refOf / capabilitiesOf', () => {
  test('refOf stamps the provider tag', () => {
    expect(refOf('native', 'm1')).toEqual({ provider: 'native', id: 'm1' })
  })

  test('capabilities derive from slot presence — native', () => {
    expect(capabilitiesOf(nativeMemoryProvider)).toEqual({
      recall: true,
      tools: true,
      ingest: true,
      records: true,
      recordsDelete: true,
      recordsRestore: true,
      feedback: false,
      webhook: false,
      purge: false,
      cursorTier: 'strict',
    })
  })

  test('capabilities derive from slot presence — minimal recall-only vendor', () => {
    expect(capabilitiesOf(minimalProvider())).toEqual({
      recall: true,
      tools: false,
      ingest: false,
      records: false,
      recordsDelete: false,
      recordsRestore: false,
      feedback: false,
      webhook: false,
      purge: false,
      cursorTier: null,
    })
  })
})
