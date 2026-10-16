import { api } from '../api.ts'

import {
  CHANGE_EVENT,
  applyFavoriteOperations,
  dispatchChange,
  favoriteIdentity,
  mergeFavoriteLists,
  readSidebarFavorites,
  readSyncMeta,
  writeFavoritesCache,
  writeSyncMeta,
} from './sidebar-favorites/store.ts'
import { createDocumentSync } from './sidebarDocumentSync.ts'

import type { SidebarFavorite, SidebarFavoriteOperation } from './sidebar-favorites/store.ts'

export {
  HREF_FAVORITE_PREFIX,
  applyFavoriteOperations,
  favoriteIdentity,
  mergeFavoriteLists,
  readSidebarFavorites,
} from './sidebar-favorites/store.ts'
export type { SidebarFavorite, SidebarFavoriteOperation } from './sidebar-favorites/store.ts'

function nextOperationId(): string {
  return globalThis.crypto.randomUUID()
}

const favoritesSync = createDocumentSync<SidebarFavorite, SidebarFavoriteOperation>({
  conflictCode: 'sidebar_favorites_changed',
  readItems: readSidebarFavorites,
  writeItems: writeFavoritesCache,
  readMeta: readSyncMeta,
  writeMeta: writeSyncMeta,
  notify: dispatchChange,
  get: async (teamId) => {
    const remote = await api.atlasGetSidebarFavorites(teamId)

    return { items: remote.entries, revision: remote.revision }
  },
  put: async (teamId, items, revision) => {
    const saved = await api.atlasPutSidebarFavorites(teamId, items, revision)

    return { items: saved.entries, revision: saved.revision }
  },
  apply: applyFavoriteOperations,
  merge: mergeFavoriteLists,
})

function enqueueOperation(
  userId: string,
  teamId: string,
  operation: SidebarFavoriteOperation,
): void {
  favoritesSync.enqueue(userId, teamId, operation)
}

/** Starts stale-while-revalidate cloud reconciliation without blocking paint. */
export function syncSidebarFavorites(userId: string, teamId: string): Promise<void> {
  return favoritesSync.sync(userId, teamId)
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
