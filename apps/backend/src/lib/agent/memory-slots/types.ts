// ===========================================================================
// lib/agent/memory-slots/types.ts  (THE SPI — what a vendor implements)
// Memory Provider SPI v1, spec §(a) PART 1 with the accepted A5/A6 amendments
// folded first-class.
// SPI file-set root: re-exports types-events / types-records.
// The set imports nothing app-local; the single permitted external import is
// the runtime's tool type. Enforced by lint boundary + CI guard test.
// ===========================================================================

import type { MemoryObserver } from './types-events'
import type { AttributionSink, MemoryStorageDescriptor, RecordsSurface } from './types-records'
import type { Tool } from 'ai'

export type * from './types-events'
export type * from './types-records'

// --- Versioning -------------------------------------------------------------

/** Bumped on any breaking change to this file. The registry refuses a provider
 * whose meta.spiVersion !== this at boot — fail loud at deploy, never at turn
 * time. In-tree adapters are compiled together, so TypeScript is the primary
 * enforcement mechanism; this constant anchors the spec changelog and the
 * conformance banner. */
export const MEMORY_SPI_VERSION = 1

// --- Common vocabulary ------------------------------------------------------

export type MemoryScope = 'personal' | 'team'

/** Duplicate of the runtime's AgentSessionOrigin — deliberate: the SPI must not
 * import runtime modules. A compile-time assertion in runtime.ts locks the two
 * unions identical. */
export type MemorySessionOrigin = 'user' | 'trigger'

/** Where the provider's memory corpus physically lives. 'external' arms the
 * egress machinery: vendorName required, the per-team override doubles as the
 * consent switch, attribution digests are withheld until
 * consent is recorded, delete MUST propagate to the vendor store
 * (conformance-tested). Per A1, external providers are override-only — the
 * registry rejects an external id as the global default at boot. */
export type MemoryDataResidency = 'local' | 'external'

/** Composite reference — the ONLY form a memory id may take in runtime-owned
 * persisted data (attribution rows, provenance entries, audit events, session
 * rollups) and on the wire (SSE frames and /memories* responses carry a
 * top-level `provider`). Providers NEVER produce or consume this type: every
 * slot speaks bare `id` strings, and the RUNTIME stamps `provider` at the call
 * boundary because it knows which provider it called — a provider physically
 * cannot assert its own identity into shared data. A bare id without its
 * provider tag is meaningless (decision 3). */
export type MemoryRef = {
  provider: string
  id: string
}

export type MemoryAvailability =
  | { state: 'ready' }
  /** Missing config; `missing` lists env keys, e.g. ['XTRACE_API_KEY'].
   * Settings UI renders the provider disabled-with-reason, never hidden. */
  | { state: 'unconfigured'; missing: string[] }
  /** setup() failed or config is present but invalid. */
  | { state: 'error'; reason: string }

// --- Slot — Tools (model-facing) ------------------------------------------

/** The runtime's tool object — Vercel AI SDK `tool()` — exactly what
 * tools-skilled spreads into the model's tool set today. Pinning to `ai` is
 * accepted for in-tree bundles (out-of-repo providers are an explicit
 * non-goal); revisit as a structural subset before any out-of-repo provider. */
export type MemoryTool = Tool

export type MemoryToolContext = {
  userId: string
  teamId: string | null
  conversationId: string
  /** Contract: providers MUST refuse durable writes unless origin === 'user'
   * (conformance-tested). Reads are origin-free. */
  origin: MemorySessionOrigin
  /** Pre-wrapped fail-open by the runtime. */
  observer: MemoryObserver
  /** Runtime-owned: resolves the single active plan number for this
   * conversation, else null. Providers may stamp it into stored evidence. */
  getActivePlanId: () => Promise<string | null>
}

export type ToolContributor = {
  /** Pure shape assembly — no I/O, must not throw. Tool EXECUTION errors are
   * ordinary failed tool results the model sees and can react to; never turn
   * errors. Tool names must not collide with runtime tools; the conventional
   * names save_memory / memory_get are reserved for whichever provider is
   * active (only one ever is, decision 3). */
  create(ctx: MemoryToolContext): Record<string, MemoryTool>
}

// --- The provider bundle -----------------------------------------------------

export type MemoryProviderMeta = {
  /** Stable machine id, /^[a-z][a-z0-9-]{1,31}$/; 'runtime' reserved (boot
   * assertion) for runtime-owned neutral collections. Appears in MemoryRef,
   * session pins, team overrides, audit rows, and the wire `provider` field.
   * Never rename a shipped id. */
  id: string
  /** Human name for settings UI and audit copy. */
  displayName: string
  /** Legal vendor name for consent copy ("conversation digests will be sent
   * to <vendorName>"). REQUIRED when dataResidency === 'external' (boot
   * assertion). */
  vendorName?: string
  dataResidency: MemoryDataResidency
  /** Must equal MEMORY_SPI_VERSION — checked at boot. */
  spiVersion: number
}

export type MemoryProvider = {
  readonly meta: MemoryProviderMeta
  /** Always `memory_${meta.id}_` (boot assertion). Every Mongo collection the
   * provider CREATES carries this prefix; teardown is drop-by-prefix.
   * Declared even by providers with zero local collections. Pre-existing
   * names (the frozen agent_* set) are grandfathered until their own swap
   * (A5⑧) — see storageDescriptor for the authoritative manifest. */
  readonly collectionPrefix: string
  /** Boot-time, idempotent, runs for EVERY registered provider — dormant
   * stores keep valid indexes so switch-back is instant (decision 3).
   * Failure marks the provider {state:'error'}; boot continues. */
  setup(): Promise<void>
  /** Cheap and local: config/key-presence checks ONLY — never a network call;
   * must settle in <50ms (conformance-tested). config.ts freezes at boot, so
   * availability is boot-constant per process; credential changes take effect
   * at the next deploy. Cached per process; the cached value is consulted on
   * every turn resolution and on team-override writes (PUT rejects a provider
   * that is not 'ready'). A throw is coerced to {state:'error', reason}. */
  availability(input: { teamId: string | null }): Promise<MemoryAvailability>
  /** TTL for the runtime's availability cache (A5⑥): lets a provider serve a
   * cheap TTL-cached health check so revoked vendor keys degrade to 'error'
   * within minutes instead of a full deploy. Absent = boot-constant cache. */
  availabilityCacheTtlMs?: number
  /** Storage manifest (A5⑧). Absent = collections derivable from
   * collectionPrefix alone. */
  storageDescriptor?(): MemoryStorageDescriptor
  /** Slots. ABSENCE IS THE CAPABILITY SIGNAL — no flags, no stub methods
   * (decision 2). At least one of tools/records required (boot assertion).
   * `feedback` is a passive sink and does NOT count toward the ≥1-slot rule.
   * There is no recall or ingest slot: the agent reads and writes memory
   * itself through the tools slot. */
  tools?: ToolContributor
  records?: RecordsSurface
  feedback?: AttributionSink
  /** Erasure hooks (A6): user/team erasure is a runtime pipeline over ALL
   * registered providers, active or dormant. Providers without these document
   * the vendor-contract erasure path in their bundle README; records-only
   * providers get enumerate-and-delete. Conformance tests the hook when
   * present. */
  purgeUser?(input: { userId: string; teamId: string | null }): Promise<void>
  purgeTeam?(teamId: string): Promise<void>
}
