// SPI file-set member (see types.ts): runtime-owned observation hooks.
// Import discipline enforced by boundaries.test.ts rule (b).

import type { MemoryScope } from './types'

// --- Observer — runtime-owned observation hooks ----------------------------

/** How a provider reports observable memory activity. The runtime turns these
 * into SSE frames, telemetry events, journal rows, and attribution floor
 * signals — always MemoryRef-stamped by the runtime.
 *
 * DELIBERATELY ABSENT: any way for a provider to report that a memory was
 * *applied*, *useful*, or *effective*. Effectiveness is judged exclusively by
 * the runtime-owned post-hoc attribution judge over the same inputs for every
 * provider. This is a fairness/anti-gaming invariant, not an oversight
 * (decision 6).
 *
 * Every method arrives ALREADY wrapped fail-open by the runtime: a throwing
 * sink logs memory.observer.*_failed and never fails the provider call that
 * fired it. Providers call these synchronously and never await them. */
export type MemoryObserver = {
  /** Durable write (explicit save, supersede) or draft creation. */
  saved(event: MemorySavedEvent): void
  /** The model actively opened a memory: get-by-id, or each returned search
   * hit. Feeds the honest "opened" provenance tier and the fetch_log
   * attribution floor. */
  fetched(event: MemoryFetchedEvent): void
  /** The model ran a memory search. */
  searched(event: MemorySearchedEvent): void
}

export type MemorySavedEvent = {
  id: string
  /** Optional-with-default on degraded hydration paths (A5⑨). */
  scope?: MemoryScope
  /** Provider's stable revision-chain key (native: lineageId). Optional —
   * rollups group by lineage ?? id. Vendors omit it. */
  lineage?: string
  /** Provider vocabulary, open ('record', 'playbook', vendor kinds). Opaque to
   * the runtime: rendered as a chip, never branched on. Primary field (A5②). */
  kind?: string
  /** One-line human label for the "learned" card / ingest event. */
  title: string
  /** 'drafted' = written to a review queue, not yet live (auto-ingest
   * proposals). Runtime copy: "Drafted a memory — pending your review".
   * 'deleted' = vendor-autonomous removal (Mem0 contradiction deletes, Zep
   * temporal invalidation; A5⑨). */
  action: 'created' | 'updated' | 'superseded' | 'drafted' | 'deleted'
  /** When action === 'superseded': the id the new memory replaces. The runtime
   * records this as a supersede_correction negative signal on the old memory.
   * Contract for `id` on these events: when the successor is known, `id` is
   * the NEW memory (and supersededId the old one); a standalone lifecycle
   * event whose successor is unknown at emit time sets `id === supersededId`
   * — the retired memory is the event's subject. Consumers keying corrections
   * must read supersededId, never id. */
  supersededId?: string
  // Optional wire enrichment — lets the runtime serve
  // GET /memories/ingest/:sessionId without a provider round-trip.
  /** Compat alias of `kind` (closed xtrace-era vocabulary; A5②). */
  type?: 'fact' | 'artifact' | 'episode'
  text?: string
  categories?: string[]
  /** Real doc timestamps (ISO), when the provider knows them. The wire
   * memory-ingest frame carries both, and they genuinely differ on paths like
   * a republished playbook (createdAt ≠ updatedAt) — a runtime "now" stamp
   * would lie there. Absent = runtime falls back to the emit moment. */
  createdAt?: string
  updatedAt?: string
}

export type MemoryFetchedEvent = {
  id: string
  scope: MemoryScope
  lineage?: string
  kind?: string
  /** Fetch-time one-line content snapshot (A4①): the attribution judge's
   * candidate content for fetched-only memories — captured HERE, never
   * re-read from the provider's store. */
  label?: string
}

export type MemorySearchedEvent = {
  /** Raw query. The runtime redacts secrets and truncates before logging —
   * providers must not pre-sanitize. */
  query: string
  hitCount: number
  /** Optional per-kind breakdown, e.g. { record: 3, playbook: 1 }. */
  hitsByKind?: Record<string, number>
}
