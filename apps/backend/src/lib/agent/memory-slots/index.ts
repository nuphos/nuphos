// Registry + boot assertions + the per-provider setup loop. The ONLY file in
// the repo that imports provider bundles (dependency rule c: call sites
// resolve providers through here, never import an adapter directly). A new
// backend = its impl dir + its adapter file + ONE line here + its env keys.
//
// Phase 2: models.ts's ['memory-providers', runMemoryProviderSetup] group
// runs setup() for EVERY registered provider — dormant stores keep valid
// indexes so switch-back is instant (decision 3). A failing setup marks that
// provider {state:'error'} in the setup-state cache consulted by
// providerAvailability(); boot always continues.

import { MongoServerError } from 'mongodb'

import { config } from '@/config'
import { logError, logEvent } from '@/lib/observability'

import { nativeMemoryProvider } from './native'
import { MEMORY_SPI_VERSION } from './types'

import type { MemoryAvailability, MemoryProvider } from './types'

const REGISTRY: Record<string, MemoryProvider> = {
  native: nativeMemoryProvider,
}

/** /^[a-z][a-z0-9-]{1,31}$/ — stable machine ids; 'runtime' reserved for the
 * runtime-owned memory_runtime_* collections (collision-free by construction). */
const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/

export function getMemoryProvider(id: string): MemoryProvider | null {
  // Own-property lookup only: a stamped id like 'constructor' walking the
  // prototype chain would resolve to a non-provider object instead of null.
  return (Object.hasOwn(REGISTRY, id) && REGISTRY[id]) || null
}

export function listMemoryProviders(): MemoryProvider[] {
  return Object.values(REGISTRY)
}

// ── Provider setup loop (Phase 2) ───────────────────────────────────────────

/** Setup-state cache: provider id → failure reason. Consulted by
 * providerAvailability() so a provider whose index build died reports
 * {state:'error'} instead of pretending to be ready. Process-local, like the
 * config it mirrors. */
const setupFailures = new Map<string, string>()

/** Test-only: the failure cache is process-global state. */
export function resetMemoryProviderSetupState(): void {
  setupFailures.clear()
}

/** models.ts group ['memory-providers', …]: runs setup() for every registered
 * provider (injectable for tests). Per-provider try/catch — one broken
 * provider marks ITSELF error and never sinks the others or the boot. Mongo
 * 85/86 index conflicts keep models.ts's tolerate-and-warn semantics (another
 * branch's backend upgraded the index on a shared replica set): the provider
 * stays available, exactly as the old direct setupTeamMemoryIndexes entry
 * behaved under tolerateIndexConflict. */
/** Boot must not hang on one provider: a future external (network-backed)
 * setup() that stalls fails into the error cache after this deadline. */
const SETUP_TIMEOUT_MS = 30_000

export async function runMemoryProviderSetup(
  providers: MemoryProvider[] = listMemoryProviders(),
  timeoutMs: number = SETUP_TIMEOUT_MS,
): Promise<void> {
  await Promise.all(
    providers.map(async (provider) => {
      const id = provider.meta.id
      let timer: ReturnType<typeof setTimeout> | undefined

      try {
        await Promise.race([
          provider.setup(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`setup() timed out after ${String(timeoutMs)}ms`))
            }, timeoutMs)
          }),
        ])
        setupFailures.delete(id) // idempotent re-run recovers a past failure
      } catch (error) {
        if (error instanceof MongoServerError && (error.code === 85 || error.code === 86)) {
          logEvent('warn', 'backend.mongodb.index_conflict_ignored', {
            label: `memory-provider:${id}`,
            message: error.message,
          })
          setupFailures.delete(id)

          return
        }
        setupFailures.set(id, error instanceof Error ? error.message : String(error))
        logError('memory.provider.setup_failed', error, { provider: id })
      } finally {
        clearTimeout(timer)
      }
    }),
  )
}

/** The runtime's availability read: the setup-state cache wins over the
 * provider's own (cheap, config-only) availability() check, and a throwing
 * availability() is coerced to {state:'error'} per the SPI contract. */
export async function providerAvailability(
  provider: MemoryProvider,
  input: { teamId: string | null },
): Promise<MemoryAvailability> {
  const failure = setupFailures.get(provider.meta.id)

  if (failure) return { state: 'error', reason: `setup failed: ${failure}` }
  try {
    return await provider.availability(input)
  } catch (error) {
    return { state: 'error', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Boot gate (called from src/index.ts before index setup): a malformed
 * registry or global default fails the DEPLOY, never a turn. Arguments are
 * injectable for tests; production callers pass none. */
export function assertRegistryInvariants(
  registry: Record<string, MemoryProvider> = REGISTRY,
  globalDefault: string = config.agent.memoryProvider,
): void {
  for (const [key, provider] of Object.entries(registry)) {
    const { meta } = provider

    if (key !== meta.id) {
      throw new Error(`memory registry key '${key}' !== meta.id '${meta.id}'`)
    }
    if (!ID_PATTERN.test(meta.id)) {
      throw new Error(`memory provider id '${meta.id}' violates ${String(ID_PATTERN)}`)
    }
    if (meta.id === 'runtime') {
      throw new Error("memory provider id 'runtime' is reserved for runtime-owned collections")
    }
    if (meta.spiVersion !== MEMORY_SPI_VERSION) {
      throw new Error(
        `memory provider '${meta.id}' spiVersion ${String(meta.spiVersion)} !== MEMORY_SPI_VERSION ${String(MEMORY_SPI_VERSION)}`,
      )
    }
    if (provider.collectionPrefix !== `memory_${meta.id}_`) {
      throw new Error(
        `memory provider '${meta.id}' collectionPrefix '${provider.collectionPrefix}' must be 'memory_${meta.id}_'`,
      )
    }
    if (meta.dataResidency === 'external' && !meta.vendorName) {
      throw new Error(
        `memory provider '${meta.id}' is external-residency and must declare vendorName (consent copy)`,
      )
    }
    if (!provider.recall && !provider.tools && !provider.ingest && !provider.records) {
      throw new Error(
        `memory provider '${meta.id}' implements no slot — at least one of recall/tools/ingest/records required (feedback does not count)`,
      )
    }
  }
  const active = Object.hasOwn(registry, globalDefault) ? registry[globalDefault] : undefined

  if (!active) {
    throw new Error(
      `MEMORY_PROVIDER global default '${globalDefault}' names no registered provider (registered: ${Object.keys(registry).join(', ')})`,
    )
  }
  // A1: external providers are override-only, never the global default — a
  // fleet-wide external default would imply unconsented egress or silent
  // memory-off for every team.
  if (active.meta.dataResidency === 'external') {
    throw new Error(
      `MEMORY_PROVIDER global default '${globalDefault}' has external data residency — external providers are team-override-only (A1)`,
    )
  }
}
