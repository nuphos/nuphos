// Runtime-owned wire layer for the /memories* records routes (Phase 2 PR 2).
// The routes stop importing memory-native/records-api and resolve a provider
// here instead; the response bodies stay byte-compatible with the legacy
// direct calls except for the sanctioned additive fields — top-level
// `provider` (the resolved provider id, which the desktop gates provider-
// shaped rendering on) and per-item `kind` (plus native's `playbook`
// dual-emit of `gene`, carried in the item's `extra`).
//
// Phase 2 has no team override: resolution is the global default through the
// registry — the same global branch resolveForTurn falls back to for
// unstamped sessions. Team overrides arrive in Phase 3.

import { config } from '@/config'
import { logEvent } from '@/lib/observability'

import { getMemoryProvider } from './index'

import type { MemoryProvider, MemoryRecordItem, MemoryScope } from './types'

export type RecordsWireViewer = {
  userId: string
  teamId: string | null
  scope: MemoryScope
}

export type ResolvedRecordsProvider = {
  provider: MemoryProvider
  providerId: string
}

/** Global default via the registry. Null only survives a mid-process registry
 * mutation — boot asserts the default is registered (assertRegistryInvariants);
 * the routes translate null into a 5xx. */
export function resolveRecordsProvider(): ResolvedRecordsProvider | null {
  const providerId = config.agent.memoryProvider
  const provider = getMemoryProvider(providerId)

  return provider ? { provider, providerId } : null
}

export type WireMemoryItem = Record<string, unknown>

/** Neutral core + verbatim `extra` spread ({ ...core, ...extra }) — how the
 * frozen wire fields (`gene`, `disabledReason`) come back out of the SPI item.
 * Extra keys must not shadow core fields: shadowing keys are dropped and
 * logged (SPI contract, types.ts). */
export function toWireMemoryItem(item: MemoryRecordItem, providerId: string): WireMemoryItem {
  const { extra, ...core } = item
  const out: Record<string, unknown> = { ...core }

  for (const [key, value] of Object.entries(extra ?? {})) {
    if (key in out) {
      logEvent('warn', 'memory.records.extra_key_shadowed', { provider: providerId, key })
      continue
    }
    out[key] = value
  }

  return out
}

const viewerOf = (viewer: RecordsWireViewer) => ({
  userId: viewer.userId,
  teamId: viewer.teamId,
  scope: viewer.scope,
})

/** Shared resolve-and-guard: null means NO USABLE PROVIDER (routes 5xx) —
 * never "not found". Method-level absence (delete/restore optional per SPI)
 * is judged by the callers, which map it to 404 instead. */
function resolveRecordsSurface():
  | (ResolvedRecordsProvider & {
      records: NonNullable<MemoryProvider['records']>
    })
  | null {
  const resolved = resolveRecordsProvider()
  const records = resolved?.provider.records

  return resolved && records ? { ...resolved, records } : null
}

/** GET /memories. Null = no resolvable records surface (route 5xxes — the
 * global default always has one today). Limit is pre-clamped to 1..100 with
 * the legacy default of 50 (SPI: the runtime clamps, providers trust). */
export async function listMemoriesWire(
  viewer: RecordsWireViewer,
  opts: { cursor?: string; limit?: number; state?: 'live' | 'removed' },
): Promise<{
  enabled: boolean
  memories: WireMemoryItem[]
  nextCursor: string | null
  hasMore: boolean
  provider: string
} | null> {
  const resolved = resolveRecordsSurface()

  if (!resolved) return null
  const { records } = resolved
  const page = await records.list({
    viewer: viewerOf(viewer),
    cursor: opts.cursor ?? null,
    limit: Math.max(1, Math.min(100, opts.limit ?? 50)),
    state: opts.state ?? 'live',
  })

  return {
    // The legacy pages always said enabled:true (the native store is the
    // process's own Mongo); kept hardcoded for wire parity.
    enabled: true,
    memories: page.items.map((item) => toWireMemoryItem(item, resolved.providerId)),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    provider: resolved.providerId,
  }
}

/** GET /memories/:memoryId. Null = no usable provider (route 5xxes);
 * `item: null` = not found (route 404s) — the two must not conflate, or a
 * mid-process registry problem masquerades as a missing memory. */
export async function getMemoryWire(
  viewer: RecordsWireViewer,
  memoryId: string,
): Promise<{ provider: string; item: WireMemoryItem | null } | null> {
  const resolved = resolveRecordsSurface()

  if (!resolved) return null
  const item = await resolved.records.get(memoryId, viewerOf(viewer))

  return {
    provider: resolved.providerId,
    item: item
      ? { ...toWireMemoryItem(item, resolved.providerId), provider: resolved.providerId }
      : null,
  }
}

/** DELETE /memories/:memoryId. `reason` is the human-stated removal reason,
 * forwarded VERBATIM — redaction/length-capping is the provider store's job
 * (native's deleteMemoryItem redacts and caps; a second pass here would
 * double-redact). Null = no usable provider (route 5xxes);
 * `supported: false` = provider without a delete method (route 404s, SPI:
 * absent capability hides the affordance). */
export async function deleteMemoryWire(
  viewer: RecordsWireViewer,
  memoryId: string,
  reason?: string,
): Promise<{ ok: boolean; supported: boolean; provider: string } | null> {
  const resolved = resolveRecordsSurface()

  if (!resolved) return null
  const { records } = resolved

  if (!records.delete) return { ok: false, supported: false, provider: resolved.providerId }
  const ok = await records.delete(memoryId, viewerOf(viewer), reason ? { reason } : {})

  return { ok, supported: true, provider: resolved.providerId }
}

/** POST /memories/:memoryId/restore. Null = no usable provider (route
 * 5xxes); `supported: false` = provider without restore (route 404s,
 * matching the SPI's "absent ⇒ the runtime 404s" contract). */
export async function restoreMemoryWire(
  viewer: RecordsWireViewer,
  memoryId: string,
): Promise<{ ok: boolean; supported: boolean; provider: string } | null> {
  const resolved = resolveRecordsSurface()

  if (!resolved) return null
  const { records } = resolved

  if (!records.restore) return { ok: false, supported: false, provider: resolved.providerId }
  const ok = await records.restore(memoryId, viewerOf(viewer))

  return { ok, supported: true, provider: resolved.providerId }
}
