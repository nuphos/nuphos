import type { ChangelogEntry } from '../types/team'

// Keep in sync with apps/desktop/electron/main/changelog-feed.ts
export const CHANGELOG_INDEX_URL = 'https://nuphos.ai/changelog'
export const LAST_SEEN_KEY = 'nuphos.whats-new.last-seen-slug'

export function hasUnread(entries: ChangelogEntry[], lastSeenSlug: string | null): boolean {
  const latest = entries.at(0)

  return latest !== undefined && latest.slug !== lastSeenSlug
}

export function readStoredSlug(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function storeSlug(key: string, slug: string) {
  try {
    localStorage.setItem(key, slug)
  } catch {
    // storage unavailable — the entry just reads as unread next launch; harmless.
  }
}
