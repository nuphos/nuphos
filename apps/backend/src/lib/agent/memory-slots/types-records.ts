// SPI file-set member (see types.ts): records wire surface, attribution
// feedback, storage manifest. Import discipline: boundaries.test.ts rule (b).

import type { MemoryScope } from './types'

// --- Slot 4 — Records (desktop /memories* wire surface) ---------------------

export type MemoryViewer = {
  userId: string
  /** Membership already verified by the runtime's auth layer; tenancy
   * ENFORCEMENT inside the store remains the provider's job — a provider
   * that ignores viewer fields has a security bug (conformance-tested:
   * team A must never see team B). */
  teamId: string | null
  scope: MemoryScope
}

export type ListRecordsInput = {
  viewer: MemoryViewer
  /** Opaque provider-owned cursor from a previous page; null = first page.
   * Garbage cursors reset to page one — never throw (existing behavior). */
  cursor: string | null
  /** Pre-clamped by the runtime to 1..100 (default 50). */
  limit: number
  /** 'removed' lists tombstoned items for the restore surface. A provider
   * without tombstones returns an empty page — not an error. */
  state: 'live' | 'removed'
}

/** Neutral core of today's wire MemoryListItem — xtrace-parity by
 * construction. */
export type MemoryRecordItem = {
  id: string
  /** Open provider vocabulary primary (A5②): 'record', 'playbook', vendor
   * kinds. The closed fact|artifact|episode enum was xtrace vocabulary
   * leaking into the neutral core. */
  kind?: string
  /** Optional compat alias of `kind` for the frozen wire contract. */
  type?: 'fact' | 'artifact' | 'episode'
  /** One-line retrieval label for flat memories. Additive because legacy and
   * external-provider records may not have one. */
  title?: string
  text: string
  categories: string[]
  createdAt: string // ISO
  updatedAt: string // ISO
  convId: string | null
  userId: string | null
  appId: string | null
  groupIds: string[]
  disabledAt?: string
  disabledBy?: string
  /** Provider-shaped structured payload. The route spreads it verbatim onto
   * the wire object — `{ ...core, ...extra }` — which is how native keeps
   * today's `gene` field byte-compatible AND dual-emits `playbook` during the
   * rename window without polluting this neutral type. Desktop gates
   * rendering of such fields on the top-level `provider` field the runtime
   * stamps on every response. Keys must not shadow core fields (runtime drops
   * shadowing keys and logs). */
  extra?: Record<string, unknown>
}

export type MemoryRecordPage = {
  items: MemoryRecordItem[]
  nextCursor: string | null
  hasMore: boolean
}

export type RecordsSurface = {
  /** Cursor conformance tier (A5⑦): 'strict' = complete + duplicate-free
   * (native); 'best-effort' = no infinite loops, eventual completeness
   * (page-number vendors, group-scoped walks). Surfaced in the capability
   * table. */
  cursorTier: 'strict' | 'best-effort'
  list(input: ListRecordsInput): Promise<MemoryRecordPage>
  get(id: string, viewer: MemoryViewer): Promise<MemoryRecordItem | null>
  /** Optional (A5①): read-only self-built providers are legal; desktop hides
   * delete when absent. When present it MUST remove the memory from the
   * provider's REAL store — for external residency that means the vendor API
   * call (xtrace precedent), never only a local flag. Local tombstoning is
   * fine iff the item stops being served everywhere except state:'removed'.
   * False = not found / not permitted. `opts.reason` is the human-stated
   * removal reason from DELETE /memories/:memoryId — the strongest negative
   * ground truth. The runtime forwards it VERBATIM (trimmed only): secret
   * redaction and length-capping are the provider store's job before
   * persisting (native precedent: deleteMemoryItem redacts and caps to 300
   * chars) — a runtime pre-pass would double-redact. Providers without a
   * reason column simply ignore it. */
  delete?(id: string, viewer: MemoryViewer, opts?: { reason?: string }): Promise<boolean>
  /** Optional soft-delete undo. Absent ⇒ the runtime 404s the restore
   * endpoint and desktop hides the affordance. */
  restore?(id: string, viewer: MemoryViewer): Promise<boolean>
}
// NOTE: no listIngestEvents. GET /memories/ingest/:sessionId is served
// entirely from the runtime's durable IngestOutcome snapshots
// (memory_runtime_ingest_events) — one less method for vendors, and learned
// events work even without a records slot.

// --- Optional feedback sink (one-way attribution push) ----------------------

/** Tiers a memory can reach in the runtime's measurement layer. Shared
 * vocabulary between the SPI's feedback digests and the runtime-owned
 * attribution store. Providers can RECEIVE tiers; they can never WRITE them.
 * Deliberate duplicate of memory-slots/attribution-types.ts (the SPI imports
 * nothing app-local); a compile-time assertion in runtime.ts locks the two
 * unions identical. */
export type AttributionTier =
  | 'recalled' // rode injected context passively (free signal)
  | 'fetched' // agent opened it via a memory tool (free signal)
  | 'considered' // judged: surfaced but not reflected in answer
  | 'applied' // judged: answer demonstrably used it
  | 'not_applicable' // judged contradicted/unused, or corrected by supersede

export type AttributionDigest = {
  /** Provider-scoped id — the provider's own memory id (no MemoryRef: the
   * batch is already addressed to its owner provider). */
  id: string
  lineage?: string
  tier: AttributionTier
  human?: 'helpful' | 'unhelpful' | 'wrong'
  at: string // ISO — no conversation content, no judge rationale, ever
}

export type AttributionSink = {
  /** Runtime pushes batches (daily job, fire-and-forget, fail-open) only for
   * memories owned by this provider. One-way: the scorecard reads exclusively
   * from memory_runtime_*; a provider can use digests to rank better next
   * turn — which is the point — but cannot touch past measurement. For
   * external residency, digests are consent-gated by the same per-team
   * switch as TurnDigests. */
  onAttribution(batch: AttributionDigest[], opts: { signal: AbortSignal }): Promise<void>
}

// --- Storage manifest (A5⑧) -------------------------------------------------

/** Teardown manifest: what the provider's stores physically are. File-backed
 * providers satisfy the drop-by-prefix teardown rule with `paths` instead of
 * a Mongo prefix. */
export type MemoryStorageDescriptor = {
  kind: 'mongo' | 'file'
  collections?: string[]
  paths?: string[]
}
