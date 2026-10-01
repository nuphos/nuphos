// Legacy favorites were scoped only by team, so there is no safe way to prove
// which user owns them on a shared Electron profile. Purge that cache instead
// of assigning it to whichever account happens to sign in after the upgrade.
const LEGACY_STORAGE_KEY = 'nuphos.sidebarFavorites'
const CACHE_STORAGE_KEY = 'nuphos.sidebarFavorites.v2'
const SYNC_STORAGE_KEY = 'nuphos.sidebarFavorites.sync.v1'

export const CHANGE_EVENT = 'nuphos:sidebar-favorites-changed'
export const MAX_CONFLICT_RETRIES = 8
export const MAX_RETRY_DELAY_MS = 60_000

export const HREF_FAVORITE_PREFIX = 'fav-href:'

export type SidebarFavorite = {
  label: string
  key?: string
  href?: string
}

export type SidebarFavoriteOperation =
  | { id: string; kind: 'upsert'; favorite: SidebarFavorite }
  | { id: string; kind: 'remove'; identity: string }

export type SyncMeta = {
  migrated: boolean
  revision: number
  pending: SidebarFavoriteOperation[]
}

export type SyncRuntime = {
  running: Promise<void> | null
  retryAttempt: number
  retryTimer: ReturnType<typeof setTimeout> | null
}

const transientFavorites = new Map<string, SidebarFavorite[]>()
const transientSyncMeta = new Map<string, SyncMeta>()

export const runtimes = new Map<string, SyncRuntime>()

/** Stable identity used for dedupe, removal, and sidebar item keys. */
export function favoriteIdentity(entry: Pick<SidebarFavorite, 'key' | 'href'>): string {
  return entry.key ?? `${HREF_FAVORITE_PREFIX}${entry.href ?? ''}`
}

export function scopeKey(userId: string, teamId: string): string {
  return `${encodeURIComponent(userId)}|${encodeURIComponent(teamId)}`
}

function parseRecord(key: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown

    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeRecord(key: string, value: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))

    return true
  } catch {
    return false
  }
}

function validFavorite(value: unknown): value is SidebarFavorite {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<SidebarFavorite>

  return (
    typeof entry.label === 'string' &&
    entry.label.length > 0 &&
    (typeof entry.key === 'string' || typeof entry.href === 'string')
  )
}

function normalizeFavorites(value: unknown): SidebarFavorite[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: SidebarFavorite[] = []

  for (const valueEntry of value) {
    if (!validFavorite(valueEntry)) continue
    const locator =
      typeof valueEntry.key === 'string'
        ? { key: valueEntry.key.slice(0, 512) }
        : { href: valueEntry.href?.slice(0, 4096) ?? '' }
    const entry: SidebarFavorite = {
      label: valueEntry.label.slice(0, 200),
      ...locator,
    }
    const identity = favoriteIdentity(entry)

    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    normalized.push(entry)
  }

  return normalized
}

function discardLegacyFavorites(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // A blocked localStorage must not make ownerless data eligible for import.
  }
}

export function readSidebarFavorites(userId: string, teamId: string): SidebarFavorite[] {
  const key = scopeKey(userId, teamId)
  const transient = transientFavorites.get(key)

  if (transient) return transient
  const cache = parseRecord(CACHE_STORAGE_KEY)

  if (Object.hasOwn(cache, key)) return normalizeFavorites(cache[key])

  discardLegacyFavorites()

  return []
}

export function writeFavoritesCache(
  userId: string,
  teamId: string,
  entries: SidebarFavorite[],
): void {
  const key = scopeKey(userId, teamId)
  const normalized = normalizeFavorites(entries)
  const cache = parseRecord(CACHE_STORAGE_KEY)

  if (writeRecord(CACHE_STORAGE_KEY, { ...cache, [key]: normalized })) {
    transientFavorites.delete(key)
  } else {
    transientFavorites.set(key, normalized)
  }
}

function validOperation(value: unknown): value is SidebarFavoriteOperation {
  if (!value || typeof value !== 'object') return false
  const operation = value as Partial<SidebarFavoriteOperation>

  if (typeof operation.id !== 'string') return false
  if (operation.kind === 'upsert') return validFavorite(operation.favorite)

  return operation.kind === 'remove' && typeof operation.identity === 'string'
}

export function readSyncMeta(userId: string, teamId: string): SyncMeta {
  const key = scopeKey(userId, teamId)
  const transient = transientSyncMeta.get(key)

  if (transient) return transient
  const raw = parseRecord(SYNC_STORAGE_KEY)[key]

  if (!raw || typeof raw !== 'object') return { migrated: false, revision: 0, pending: [] }
  const value = raw as Partial<SyncMeta>

  return {
    migrated: value.migrated === true,
    revision:
      typeof value.revision === 'number' && Number.isSafeInteger(value.revision)
        ? Math.max(0, value.revision)
        : 0,
    pending: Array.isArray(value.pending) ? value.pending.filter(validOperation) : [],
  }
}

export function writeSyncMeta(userId: string, teamId: string, meta: SyncMeta): void {
  const key = scopeKey(userId, teamId)
  const all = parseRecord(SYNC_STORAGE_KEY)

  if (writeRecord(SYNC_STORAGE_KEY, { ...all, [key]: meta })) {
    transientSyncMeta.delete(key)
  } else {
    transientSyncMeta.set(key, meta)
  }
}

export function dispatchChange(userId: string, teamId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId, teamId } }))
}

export function mergeFavoriteLists(
  primary: SidebarFavorite[],
  secondary: SidebarFavorite[],
): SidebarFavorite[] {
  const merged = normalizeFavorites(primary)
  const identities = new Set(merged.map(favoriteIdentity))

  for (const entry of normalizeFavorites(secondary)) {
    const identity = favoriteIdentity(entry)

    if (identities.has(identity)) continue
    identities.add(identity)
    merged.push(entry)
  }

  return merged
}

export function applyFavoriteOperations(
  entries: SidebarFavorite[],
  operations: SidebarFavoriteOperation[],
): SidebarFavorite[] {
  let next = normalizeFavorites(entries)

  for (const operation of operations) {
    if (operation.kind === 'remove') {
      next = next.filter((entry) => favoriteIdentity(entry) !== operation.identity)
      continue
    }
    const identity = favoriteIdentity(operation.favorite)
    const index = next.findIndex((entry) => favoriteIdentity(entry) === identity)

    if (index === -1) next.push(operation.favorite)
    else next[index] = operation.favorite
  }

  return normalizeFavorites(next)
}
