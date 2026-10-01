const RESOURCE_LIST_CACHE_PREFIX = 'atlas.resource-list.'
const RESOURCE_LIST_CACHE_VERSION = 1

type CacheRecord<T> = {
  version: number
  updatedAt: number
  items: T[]
}

export type ResourceListLoader<T> = (() => Promise<T[]>) & {
  cacheKey?: string
}

export function withResourceListCache<T>(
  cacheKey: string | undefined,
  loader: () => Promise<T[]>,
): ResourceListLoader<T> {
  // An absent cacheKey means "don't persist" — callers pass `undefined` when a
  // credential (e.g. an AWS role / GCP service account) hasn't resolved yet, so
  // we never hydrate a list under an ambiguous bucket. read/write already no-op
  // on an undefined key; leaving `cacheKey` unset also disables the read seed.
  const cachedLoader: ResourceListLoader<T> = async () => {
    const items = await loader()

    writeCachedResourceList(cacheKey, items)

    return items
  }

  cachedLoader.cacheKey = cacheKey

  return cachedLoader
}

/**
 * Build a stable, collision-free cache key for a resource list.
 *
 * The key encodes the provider plus whatever uniquely identifies the dataset —
 * team, the scoped account/project id, the credential id (role / service
 * account), the resource name, and any extra discriminator (e.g. a zone id).
 * `undefined`/`null`/empty parts are dropped so callers can pass optional
 * credential ids without producing `.../undefined/...` keys, and every part is
 * URL-encoded so slashes inside ids can't corrupt the key shape.
 *
 *   resourceListCacheKey('gcp', [teamId, projectId, serviceAccountId, 'vpcs'])
 *   resourceListCacheKey('cloudflare', [teamId, accountId, 'dns', zoneId])
 */
export function resourceListCacheKey(
  provider: string,
  parts: (string | number | undefined | null)[],
): string {
  return [provider, ...parts]
    .filter((part): part is string | number => part !== undefined && part !== null && part !== '')
    .map((part) => encodeURIComponent(String(part)))
    .join('/')
}

export function readCachedResourceList<T>(
  cacheKey: string | undefined,
): { items: T[]; updatedAt: number } | null {
  if (!cacheKey || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(cacheKey))

    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CacheRecord<T>>

    if (parsed.version !== RESOURCE_LIST_CACHE_VERSION) return null
    if (!Array.isArray(parsed.items) || typeof parsed.updatedAt !== 'number') return null

    return { items: parsed.items, updatedAt: parsed.updatedAt }
  } catch {
    return null
  }
}

export function writeCachedResourceList<T>(cacheKey: string | undefined, items: T[]): void {
  if (!cacheKey || typeof window === 'undefined') return
  try {
    const record: CacheRecord<T> = {
      version: RESOURCE_LIST_CACHE_VERSION,
      updatedAt: Date.now(),
      items,
    }

    window.localStorage.setItem(storageKey(cacheKey), JSON.stringify(record))
  } catch {
    // Cache writes should never make the resource list itself fail.
  }
}

function storageKey(cacheKey: string): string {
  return `${RESOURCE_LIST_CACHE_PREFIX}${cacheKey}`
}
