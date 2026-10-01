// Runtime discipline for the Memory Provider SPI: session/turn resolution,
// the fail-open observer factory, the recall budget race, MemoryRef stamping,
// and capabilitiesOf(). Runtime-OWNED — providers never import this module.
// Phase 1 ships it unwired; Phase 2 swaps the call sites onto it.

import { config } from '@/config'
import { logError } from '@/lib/observability'

import { getMemoryProvider, providerAvailability } from './index'

import type { AgentSessionOrigin } from '../tools-triggers'
import type { AttributionTier as RuntimeAttributionTier } from './attribution-types'
import type {
  AttributionTier as SpiAttributionTier,
  MemoryAvailability,
  MemoryObserver,
  MemoryProvider,
  MemoryRef,
  MemorySessionOrigin,
  RecallInput,
  RenderedMemoryContext,
} from './types'

// ── Compile-time parity locks ────────────────────────────────────────────────
// The SPI deliberately duplicates two runtime unions (types.ts imports nothing
// app-local). These locks fail the build the moment either side drifts.

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

true satisfies MutuallyAssignable<MemorySessionOrigin, AgentSessionOrigin>
true satisfies MutuallyAssignable<SpiAttributionTier, RuntimeAttributionTier>

// ── Resolution ───────────────────────────────────────────────────────────────
// Precedence: session stamp > team override > global default (spec §e). The
// two functions split because the stamp-write moment and the per-turn read
// have different failure semantics.

export type ResolutionSource = 'session' | 'team' | 'global'

export type TurnResolution =
  | { kind: 'active'; provider: MemoryProvider; providerId: string; source: ResolutionSource }
  | {
      kind: 'disabled'
      providerId: string | null
      reason: 'unregistered' | 'unavailable' | 'consent_revoked'
    }

/** Called exactly once, at AgentConversation insert — the stamp records the
 * OUTCOME, not the source. Phase 1: the global default is the only source
 * (boot-asserted registered + local). Team overrides arrive in Phase 3: a
 * registered + ready override will win here with source 'team'; a broken one
 * falls back with a memory.override.broken warn and is never auto-cleared
 * (the override doubles as a consent record). */
export { resolveForNewSession } from './session-stamp'

/** Called every turn. Honors the stamp ABSOLUTELY — never re-routes
 * mid-session (decision 4): a stamped id that is unregistered resolves to
 * memory-off for the remainder of that session; re-routing would fabricate
 * cross-provider id references in provenance (decision 3). Unstamped legacy
 * sessions resolve dynamically to the global default — the lazy write-once
 * stamping is a Phase 2 call-site concern; this resolver only reads. */
export function resolveForTurn(
  conversation: { memoryProvider?: string },
  _team: { teamId: string | null },
): TurnResolution {
  const stamped = conversation.memoryProvider

  if (stamped) {
    const provider = getMemoryProvider(stamped)

    if (!provider) return { kind: 'disabled', providerId: stamped, reason: 'unregistered' }

    return { kind: 'active', provider, providerId: stamped, source: 'session' }
  }
  const providerId = config.agent.memoryProvider
  const provider = getMemoryProvider(providerId)

  // Boot asserts the global default is registered; this branch survives only
  // a mid-process registry mutation, and degrades honestly.
  if (!provider) return { kind: 'disabled', providerId, reason: 'unregistered' }

  return { kind: 'active', provider, providerId, source: 'global' }
}

/** The chat path's per-turn resolver (Phase 2 call-site swap): resolveForTurn
 * composed with the setup/availability gate (providerAvailability — the
 * setup-state cache wins over the provider's own cheap check). Stamped-
 * absolute semantics are preserved: a stamped provider that is registered but
 * not 'ready' resolves to memory-off for this turn — it never re-routes to
 * the global default (decision 4; re-routing would fabricate cross-provider
 * id references, decision 3). Never throws: an availability failure is
 * already coerced to {state:'error'} inside providerAvailability. */
/** Same shape as the setup deadline: an availability read that outlives this
 * budget resolves error (memory-off turn), never a stall. */
const AVAILABILITY_BUDGET_MS = 5_000

export async function resolveTurnProvider(
  conversation: { memoryProvider?: string },
  team: { teamId: string | null },
): Promise<TurnResolution> {
  const resolution = resolveForTurn(conversation, team)

  if (resolution.kind !== 'active') return resolution

  return gateResolutionOnAvailability(resolution, team)
}

/** The chat handler's stamp-read block, extracted so the failure mode is unit-
 * testable: read the conversation's provider stamp, resolve the turn, lazily
 * stamp legacy conversations. A stamp-read FAILURE resolves the turn
 * memory-off (fail closed, zebra #643 F1): falling open to the global default
 * would let a vendor-stamped conversation run — and ingest into — the default
 * provider for one turn (a cross-provider write, decision 3/4). A SUCCESSFUL
 * read that finds no stamp keeps the legacy behavior: global default plus the
 * fire-and-forget write-once stamp. */
export async function resolveTurnFromStamp(input: {
  /** Projected stamp read (getConversationMemoryProvider in production). */
  readStamp: () => Promise<string | undefined>
  /** Fire-and-forget write-once stamp — invoked only after a SUCCESSFUL read
   * found no stamp and the turn resolved active. Must not throw. */
  lazyStamp: (providerId: string) => void
  team: { teamId: string | null }
}): Promise<TurnResolution> {
  let stamped: string | undefined

  try {
    stamped = await input.readStamp()
  } catch (err) {
    // Memory-off is silent for the user; ops needs the trace — and needs to
    // know the turn degraded rather than fell back.
    logError('agent.memory.stamp_read_error', err, {
      teamId: input.team.teamId,
      degraded: 'memory-off turn',
    })

    return { kind: 'disabled', providerId: null, reason: 'unavailable' }
  }
  const resolution = await resolveTurnProvider({ memoryProvider: stamped }, input.team)

  if (!stamped && resolution.kind === 'active') input.lazyStamp(resolution.providerId)

  return resolution
}

/** The availability gate behind resolveTurnProvider, separated so tests can
 * feed it a doctored provider (budgetMs likewise injectable — production
 * callers pass neither). The read sits on the turn's critical path (tool
 * creation awaits it): race it against a fixed budget so a future vendor's
 * network-backed availability() can never stall every turn — same discipline
 * as the setup deadline in index.ts. */
export async function gateResolutionOnAvailability(
  resolution: Extract<TurnResolution, { kind: 'active' }>,
  team: { teamId: string | null },
  budgetMs: number = AVAILABILITY_BUDGET_MS,
): Promise<TurnResolution> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let availability: MemoryAvailability

  try {
    availability = await Promise.race([
      providerAvailability(resolution.provider, { teamId: team.teamId }),
      new Promise<MemoryAvailability>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            state: 'error',
            reason: `availability check exceeded ${String(budgetMs)}ms`,
          })
        }, budgetMs)
      }),
    ])
  } finally {
    // A ready result must not leave the deadline pending for budgetMs.
    clearTimeout(timer)
  }
  if (availability.state !== 'ready') {
    // Memory-off is silent for the user; ops needs the trace (a provider
    // whose setup died degrades every turn until the next deploy).
    logError(
      'memory.provider.unavailable',
      new Error(
        availability.state === 'error'
          ? availability.reason
          : `unconfigured: missing ${availability.missing.join(', ')}`,
      ),
      { provider: resolution.providerId },
    )

    return { kind: 'disabled', providerId: resolution.providerId, reason: 'unavailable' }
  }

  return resolution
}

export { createMemoryObserver, raceRecallBudget } from './runtime-guards'

// ── MemoryRef stamping + derived capabilities ───────────────────────────────

/** The runtime stamps provider identity at the call boundary — a provider
 * physically cannot assert its own tag into shared data (decision 3). */
export function refOf(providerId: string, id: string): MemoryRef {
  return { provider: providerId, id }
}

export type MemoryCapabilities = {
  recall: boolean
  tools: boolean
  ingest: boolean
  records: boolean
  recordsDelete: boolean
  recordsRestore: boolean
  feedback: boolean
  webhook: boolean
  purge: boolean
  cursorTier: 'strict' | 'best-effort' | null
}

/** Capabilities are DERIVED from slot presence — never self-declared
 * (decision 2). Feeds the settings UI chips and the conformance banner. */
export function capabilitiesOf(provider: MemoryProvider): MemoryCapabilities {
  return {
    recall: !!provider.recall,
    tools: !!provider.tools,
    ingest: !!provider.ingest,
    records: !!provider.records,
    recordsDelete: !!provider.records?.delete,
    recordsRestore: !!provider.records?.restore,
    feedback: !!provider.feedback,
    webhook: !!provider.webhook,
    purge: !!provider.purgeUser || !!provider.purgeTeam,
    cursorTier: provider.records?.cursorTier ?? null,
  }
}
