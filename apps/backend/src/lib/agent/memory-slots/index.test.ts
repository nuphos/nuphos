// T4: provider registry + boot assertions. Invariants are injectable so every
// rejection path is testable without touching the real registry; the real
// registry + real global default must pass the same gate (that IS the boot
// call in src/index.ts).

import { describe, expect, test } from 'bun:test'

import { MEMORY_SPI_VERSION } from './types'

import { assertRegistryInvariants, getMemoryProvider, listMemoryProviders } from './index'

import type { MemoryProvider } from './types'

const makeProvider = (
  over: {
    id?: string
    spiVersion?: number
    collectionPrefix?: string
    dataResidency?: 'local' | 'external'
    vendorName?: string
    slots?: Partial<Pick<MemoryProvider, 'recall' | 'tools' | 'ingest' | 'records'>> | null
  } = {},
): MemoryProvider => ({
  meta: {
    id: over.id ?? 'fake',
    displayName: 'Fake Provider',
    dataResidency: over.dataResidency ?? 'local',
    spiVersion: over.spiVersion ?? MEMORY_SPI_VERSION,
    ...(over.vendorName ? { vendorName: over.vendorName } : {}),
  },
  collectionPrefix: over.collectionPrefix ?? `memory_${over.id ?? 'fake'}_`,
  setup: async () => {},
  availability: async () => ({ state: 'ready' }),
  // null = deliberately slotless (invariant violation); default one slot.
  ...(over.slots === null ? {} : (over.slots ?? { recall: { render: async () => null } })),
})

const reg = (...providers: MemoryProvider[]): Record<string, MemoryProvider> =>
  Object.fromEntries(providers.map((p) => [p.meta.id, p]))

describe('registry surface', () => {
  test('native is registered and retrievable', () => {
    const native = getMemoryProvider('native')

    expect(native).not.toBeNull()
    expect(native!.meta.id).toBe('native')
    expect(getMemoryProvider('nope')).toBeNull()
    expect(listMemoryProviders().map((p) => p.meta.id)).toEqual(['native'])
  })

  test('the REAL registry + REAL global default pass the boot gate', () => {
    expect(() => assertRegistryInvariants()).not.toThrow()
  })
})

describe('assertRegistryInvariants', () => {
  test('accepts a well-formed registry', () => {
    const p = makeProvider({ id: 'fake' })

    expect(() => assertRegistryInvariants(reg(p), 'fake')).not.toThrow()
  })

  test('rejects registry key !== meta.id', () => {
    const p = makeProvider({ id: 'fake' })

    expect(() => assertRegistryInvariants({ other: p }, 'other')).toThrow(/key/)
  })

  test('rejects malformed ids', () => {
    for (const id of ['Fake', '1fake', 'f', 'fa_ke', 'x'.repeat(33), 'fake!']) {
      const p = makeProvider({ id, collectionPrefix: `memory_${id}_` })

      expect(() => assertRegistryInvariants(reg(p), id)).toThrow(/id/)
    }
  })

  test("rejects the reserved id 'runtime'", () => {
    const p = makeProvider({ id: 'runtime' })

    expect(() => assertRegistryInvariants(reg(p), 'runtime')).toThrow(/runtime/)
  })

  test('rejects an SPI version mismatch', () => {
    const p = makeProvider({ id: 'fake', spiVersion: MEMORY_SPI_VERSION + 1 })

    expect(() => assertRegistryInvariants(reg(p), 'fake')).toThrow(/spi/i)
  })

  test('rejects a collection prefix not derived from the id', () => {
    const p = makeProvider({ id: 'fake', collectionPrefix: 'memory_other_' })

    expect(() => assertRegistryInvariants(reg(p), 'fake')).toThrow(/collectionPrefix/)
  })

  test('rejects external residency without vendorName', () => {
    const local = makeProvider({ id: 'fake' })
    const ext = makeProvider({ id: 'vendor', dataResidency: 'external' })

    expect(() => assertRegistryInvariants(reg(local, ext), 'fake')).toThrow(/vendorName/)
    const withVendor = makeProvider({
      id: 'vendor',
      dataResidency: 'external',
      vendorName: 'Vendor Inc',
    })

    expect(() => assertRegistryInvariants(reg(local, withVendor), 'fake')).not.toThrow()
  })

  test('rejects a provider with zero slots (feedback does not count)', () => {
    const p = makeProvider({ id: 'fake', slots: null })

    expect(() => assertRegistryInvariants(reg(p), 'fake')).toThrow(/slot/)
  })

  test('accepts each single slot as sufficient', () => {
    const slots: Partial<Pick<MemoryProvider, 'recall' | 'tools' | 'ingest' | 'records'>>[] = [
      { recall: { render: async () => null } },
      { tools: { create: () => ({}) } },
      { ingest: { onTurnFinished: async () => null } },
      {
        records: {
          cursorTier: 'strict',
          list: async () => ({ items: [], nextCursor: null, hasMore: false }),
          get: async () => null,
        },
      },
    ]

    for (const slot of slots) {
      const p = makeProvider({ id: 'fake', slots: slot })

      expect(() => assertRegistryInvariants(reg(p), 'fake')).not.toThrow()
    }
  })

  test('rejects an unregistered global default (deploy-time typo, never a turn error)', () => {
    const p = makeProvider({ id: 'fake' })

    expect(() => assertRegistryInvariants(reg(p), 'tyop')).toThrow(/default/)
  })

  test('prototype keys are not registered providers (own-property lookups only)', () => {
    const p = makeProvider({ id: 'fake' })

    for (const inherited of ['constructor', 'toString', '__proto__']) {
      expect(() => assertRegistryInvariants(reg(p), inherited)).toThrow(
        /names no registered provider/,
      )
    }
    expect(getMemoryProvider('constructor')).toBeNull()
    expect(getMemoryProvider('toString')).toBeNull()
  })

  test('rejects an external provider as the global default (A1: override-only)', () => {
    const local = makeProvider({ id: 'fake' })
    const ext = makeProvider({ id: 'vendor', dataResidency: 'external', vendorName: 'Vendor Inc' })

    expect(() => assertRegistryInvariants(reg(local, ext), 'vendor')).toThrow(/external/)
    expect(() => assertRegistryInvariants(reg(local, ext), 'fake')).not.toThrow()
  })
})
