const MAX_METADATA_CACHE_ENTRIES = 500

export const MONGO_CATALOG_CACHE_TTL_MS = 15_000

type MongoCatalogCacheEntry = {
  expiresAt: number
  value: Promise<unknown>
}

const mongoCatalogCache = new Map<string, MongoCatalogCacheEntry>()

function catalogCacheKey(parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':')
}

function pruneMongoCatalogCache(now: number): void {
  for (const [key, entry] of mongoCatalogCache) {
    if (entry.expiresAt <= now) mongoCatalogCache.delete(key)
  }
  while (mongoCatalogCache.size >= MAX_METADATA_CACHE_ENTRIES) {
    const oldest = mongoCatalogCache.keys().next().value as string | undefined

    if (!oldest) break
    mongoCatalogCache.delete(oldest)
  }
}

/**
 * Short-lived metadata cache. Callers must only use redacted resource ids and
 * catalog scope names as key parts; raw connection URIs never enter the key.
 */
export async function cachedMongoCatalog<T>(
  keyParts: string[],
  refresh: boolean,
  loader: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const key = catalogCacheKey(keyParts)

  if (refresh) mongoCatalogCache.delete(key)
  const cached = mongoCatalogCache.get(key)

  if (cached && cached.expiresAt > now) return cached.value as Promise<T>

  pruneMongoCatalogCache(now)
  const entry: MongoCatalogCacheEntry = {
    expiresAt: now + MONGO_CATALOG_CACHE_TTL_MS,
    value: Promise.resolve().then(loader),
  }

  mongoCatalogCache.set(key, entry)
  try {
    return (await entry.value) as T
  } catch (error) {
    if (mongoCatalogCache.get(key) === entry) mongoCatalogCache.delete(key)
    throw error
  }
}

export function invalidateMongoCatalogCache(connectionId: string): void {
  const prefix = `${encodeURIComponent(connectionId)}:`

  for (const key of mongoCatalogCache.keys()) {
    if (key.startsWith(prefix)) mongoCatalogCache.delete(key)
  }
}
