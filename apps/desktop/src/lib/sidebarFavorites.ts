import { api, parseAtlasError } from '../api.ts'

import {
  CHANGE_EVENT,
  MAX_CONFLICT_RETRIES,
  MAX_RETRY_DELAY_MS,
  applyFavoriteOperations,
  dispatchChange,
  favoriteIdentity,
  mergeFavoriteLists,
  readSidebarFavorites,
  readSyncMeta,
  runtimes,
  scopeKey,
  writeFavoritesCache,
  writeSyncMeta,
} from './sidebar-favorites/store.ts'

import type { SidebarFavoritesCloudSnapshot } from '../types.ts'
import type {
  SidebarFavorite,
  SidebarFavoriteOperation,
  SyncRuntime,
} from './sidebar-favorites/store.ts'

export {
  HREF_FAVORITE_PREFIX,
  applyFavoriteOperations,
  favoriteIdentity,
  mergeFavoriteLists,
  readSidebarFavorites,
} from './sidebar-favorites/store.ts'
export type { SidebarFavorite, SidebarFavoriteOperation } from './sidebar-favorites/store.ts'

function sameFavorites(left: SidebarFavorite[], right: SidebarFavorite[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function nextOperationId(): string {
  return globalThis.crypto.randomUUID()
}

function enqueueOperation(
  userId: string,
  teamId: string,
  operation: SidebarFavoriteOperation,
): void {
  const meta = readSyncMeta(userId, teamId)

  writeSyncMeta(userId, teamId, { ...meta, pending: [...meta.pending, operation] })
  void kickSync(userId, teamId)
}

function commitSnapshot(
  userId: string,
  teamId: string,
  snapshot: SidebarFavoritesCloudSnapshot,
  capturedOperationIds: Set<string>,
): void {
  const latest = readSyncMeta(userId, teamId)
  const remaining = latest.pending.filter((operation) => !capturedOperationIds.has(operation.id))

  writeSyncMeta(userId, teamId, {
    migrated: true,
    revision: snapshot.revision,
    pending: remaining,
  })
  // A mutation may have landed while the request was in flight. Reapply those
  // remaining operations so an old response can never overwrite newer intent.
  writeFavoritesCache(userId, teamId, applyFavoriteOperations(snapshot.entries, remaining))
  dispatchChange(userId, teamId)
}

async function reconcileOnce(userId: string, teamId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
    const remote = await api.atlasGetSidebarFavorites(teamId)
    const meta = readSyncMeta(userId, teamId)
    const local = readSidebarFavorites(userId, teamId)
    const captured = meta.pending
    const capturedIds = new Set(captured.map((operation) => operation.id))
    const base = meta.migrated ? remote.entries : mergeFavoriteLists(remote.entries, local)
    const desired = applyFavoriteOperations(base, captured)

    if (sameFavorites(desired, remote.entries)) {
      commitSnapshot(userId, teamId, remote, capturedIds)

      return
    }

    try {
      const saved = await api.atlasPutSidebarFavorites(teamId, desired, remote.revision)

      commitSnapshot(userId, teamId, saved, capturedIds)

      return
    } catch (error) {
      if (parseAtlasError(error).code === 'sidebar_favorites_changed') continue
      throw error
    }
  }

  throw new Error('Favorites kept changing concurrently')
}

function retryableSyncError(error: unknown): boolean {
  const code = parseAtlasError(error).code

  return ![
    'forbidden',
    'invalid_id',
    'validation_error',
    'route_not_found',
    'subscription_required',
  ].includes(code ?? '')
}

function runtimeFor(userId: string, teamId: string): SyncRuntime {
  const key = scopeKey(userId, teamId)
  const existing = runtimes.get(key)

  if (existing) return existing
  const runtime: SyncRuntime = { running: null, retryAttempt: 0, retryTimer: null }

  runtimes.set(key, runtime)

  return runtime
}

function scheduleRetry(userId: string, teamId: string, runtime: SyncRuntime): void {
  if (runtime.retryTimer) return
  const delay = Math.min(1000 * 2 ** runtime.retryAttempt, MAX_RETRY_DELAY_MS)

  runtime.retryAttempt += 1
  runtime.retryTimer = setTimeout(() => {
    runtime.retryTimer = null
    void kickSync(userId, teamId)
  }, delay)
}

function kickSync(userId: string, teamId: string): Promise<void> {
  if (!userId || !teamId) return Promise.resolve()
  const runtime = runtimeFor(userId, teamId)

  if (runtime.running) return runtime.running
  if (runtime.retryTimer) {
    clearTimeout(runtime.retryTimer)
    runtime.retryTimer = null
  }
  let failed = false

  runtime.running = reconcileOnce(userId, teamId)
    .then(() => {
      runtime.retryAttempt = 0
    })
    .catch((error: unknown) => {
      failed = true
      if (retryableSyncError(error)) scheduleRetry(userId, teamId, runtime)
    })
    .finally(() => {
      runtime.running = null
      if (!failed && readSyncMeta(userId, teamId).pending.length > 0) {
        void kickSync(userId, teamId)
      }
    })

  return runtime.running
}

/** Starts stale-while-revalidate cloud reconciliation without blocking paint. */
export function syncSidebarFavorites(userId: string, teamId: string): Promise<void> {
  return kickSync(userId, teamId)
}

/** Returns false if an entry with the same identity is already pinned. */
export function addSidebarFavorite(
  userId: string,
  teamId: string,
  entry: SidebarFavorite,
): boolean {
  const current = readSidebarFavorites(userId, teamId)

  if (current.some((item) => favoriteIdentity(item) === favoriteIdentity(entry))) return false
  writeFavoritesCache(userId, teamId, [...current, entry])
  dispatchChange(userId, teamId)
  enqueueOperation(userId, teamId, { id: nextOperationId(), kind: 'upsert', favorite: entry })

  return true
}

export function removeSidebarFavorite(userId: string, teamId: string, identity: string): void {
  writeFavoritesCache(
    userId,
    teamId,
    readSidebarFavorites(userId, teamId).filter((entry) => favoriteIdentity(entry) !== identity),
  )
  dispatchChange(userId, teamId)
  enqueueOperation(userId, teamId, { id: nextOperationId(), kind: 'remove', identity })
}

/** Notifies on changes to this user's favorites for one team. */
export function subscribeSidebarFavorites(
  userId: string,
  teamId: string,
  onChange: () => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string; teamId?: string }>).detail

    if (detail.userId === userId && detail.teamId === teamId) onChange()
  }

  window.addEventListener(CHANGE_EVENT, handler)

  return () => window.removeEventListener(CHANGE_EVENT, handler)
}
