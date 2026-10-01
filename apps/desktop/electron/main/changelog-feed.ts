export type ChangelogEntry = {
  slug: string
  title: string
  summary: string
  date: string
  coverUrl: string
  url: string
}

// Keep in sync with apps/desktop/src/lib/whatsNew.ts
export const CHANGELOG_INDEX_URL = 'https://nuphos.ai/changelog'
export const CHANGELOG_PAGE_PREFIX = 'https://nuphos.ai/changelog/'
export const CHANGELOG_FEED_URL = 'https://nuphos.ai/changelog/feed.json'

function isEntry(v: unknown): v is ChangelogEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>

  return (
    typeof e.slug === 'string' &&
    e.slug.length > 0 &&
    typeof e.title === 'string' &&
    e.title.length > 0 &&
    typeof e.summary === 'string' &&
    typeof e.date === 'string' &&
    !Number.isNaN(Date.parse(e.date)) &&
    typeof e.coverUrl === 'string' &&
    e.coverUrl.startsWith('https://') &&
    typeof e.url === 'string' &&
    e.url.startsWith(CHANGELOG_PAGE_PREFIX)
  )
}

/**
 * Returns the valid entries of a v1 feed, or null when the payload is not a
 * v1 feed at all (wrong shape or version — the caller treats it the same as
 * an unreachable feed). Individually malformed entries are dropped rather
 * than failing the whole feed.
 */
export function parseChangelogFeed(input: unknown): ChangelogEntry[] | null {
  if (typeof input !== 'object' || input === null) return null
  const feed = input as Record<string, unknown>

  if (feed.version !== 1 || !Array.isArray(feed.entries)) return null

  return feed.entries.filter(isEntry)
}
