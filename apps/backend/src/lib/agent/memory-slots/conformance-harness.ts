import type { capabilitiesOf } from './runtime'
import type { MemoryObserver, MemoryProvider, MemoryViewer } from './types'

export type ConformanceTenant = {
  userId: string
  teamId: string | null
}

export type ConformanceHarness = {
  provider: MemoryProvider
  /** Two FULLY disjoint tenants — different users, different teams. */
  tenantA: ConformanceTenant
  tenantB: ConformanceTenant
  /** Seed one memory via the provider's NATURAL write path (its own tool /
   * surface, never a raw store write). Returns the new memory id, or
   * null when the provider refused the write. `opts.observer` is threaded into the write
   * path so observer corroboration can capture the emitted events. */
  seed(
    tenant: ConformanceTenant,
    input: { text: string; title: string },
    opts?: { observer?: MemoryObserver },
  ): Promise<string | null>
  /** Ground truth BYPASSING RecordsSurface (raw collection / vendor API):
   * true while the item is live in the provider's real store; false once
   * hard-deleted or tombstoned out of every live surface. */
  existsInRealStore(id: string): Promise<boolean>
  /** Runs fn with the provider's backing store failing. */
  withFaultInjection<T>(fn: () => Promise<T>): Promise<T>
  cleanup(): Promise<void>
  /** Optional (item 11): every collection name the provider's store touched.
   * Absent ⇒ the collection-prefix integration check is skipped. */
  listStoreCollections?(): Promise<string[]>
}

export type ConformanceContext = {
  harness: ConformanceHarness
  provider: MemoryProvider
  caps: ReturnType<typeof capabilitiesOf>
  seedOrThrow: (
    tenant: ConformanceTenant,
    input: { text: string; title: string },
    opts?: { observer?: MemoryObserver },
  ) => Promise<string>
}

export const abortOpts = () => ({ signal: new AbortController().signal })

export const viewerOf = (tenant: ConformanceTenant): MemoryViewer => ({
  userId: tenant.userId,
  teamId: tenant.teamId,
  scope: 'personal',
})
