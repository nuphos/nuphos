// T5: runtime resolution discipline and the observer factory.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useObservability } from '@/lib/test/doubles/observability'

import { nativeMemoryProvider } from './native'
import {
  capabilitiesOf,
  createMemoryObserver,
  gateResolutionOnAvailability,
  refOf,
  resolveForNewSession,
  resolveForTurn,
  resolveTurnFromStamp,
  resolveTurnProvider,
} from './runtime'

import { resetMemoryProviderSetupState, runMemoryProviderSetup } from './index'

import type { MemoryProvider } from './types'

const errors: { event: string }[] = []

useObservability({
  logError: (event) => {
    errors.push({ event })
  },
})

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
  tools: { create: () => ({}) },
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

describe('refOf / capabilitiesOf', () => {
  test('refOf stamps the provider tag', () => {
    expect(refOf('native', 'm1')).toEqual({ provider: 'native', id: 'm1' })
  })

  test('capabilities derive from slot presence — native', () => {
    expect(capabilitiesOf(nativeMemoryProvider)).toEqual({
      tools: true,
      records: true,
      recordsDelete: true,
      recordsRestore: true,
      feedback: false,
      purge: false,
      cursorTier: 'strict',
    })
  })

  test('capabilities derive from slot presence — minimal tools-only vendor', () => {
    expect(capabilitiesOf(minimalProvider())).toEqual({
      tools: true,
      records: false,
      recordsDelete: false,
      recordsRestore: false,
      feedback: false,
      purge: false,
      cursorTier: null,
    })
  })
})
