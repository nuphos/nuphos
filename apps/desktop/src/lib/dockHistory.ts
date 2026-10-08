import { readLocalStorage, writeLocalStorage } from '../app/localStorage.ts'

/** A page a dock tab has shown: a dashboard, a repo, a web page, anything. */
export type DockHistoryEntry = { href: string; title: string; count: number; openedAt: number }

const MAX_ENTRIES = 500
const CHANGE_EVENT = 'nuphos:dock-history'
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

export function dockHistoryKey(userId: string, teamId: string): string {
  return `nuphos.dockHistory.${encodeURIComponent(userId)}.${encodeURIComponent(teamId)}`
}

/** How often and how recently a page was opened; each open counts half after a week. */
export function frecency(entry: DockHistoryEntry, now: number): number {
  return entry.count * 0.5 ** ((now - entry.openedAt) / HALF_LIFE_MS)
}

const byFrecency = (now: number) => (a: DockHistoryEntry, b: DockHistoryEntry) =>
  frecency(b, now) - frecency(a, now)

export function parseDockHistory(raw: string | null): DockHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')

    if (!Array.isArray(value)) return []

    return value.filter(
      (entry: unknown): entry is DockHistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        'href' in entry &&
        'title' in entry &&
        'count' in entry &&
        'openedAt' in entry &&
        typeof entry.href === 'string' &&
        entry.href.startsWith('/') &&
        typeof entry.title === 'string' &&
        typeof entry.count === 'number' &&
        typeof entry.openedAt === 'number' &&
        Number.isFinite(entry.openedAt),
    )
  } catch {
    return []
  }
}

/**
 * Records that a dock tab shows `href`. `opened` counts a visit; a later title
 * for the same page (a dashboard name replacing its placeholder) only renames.
 */
export function recordDockVisit(
  userId: string,
  teamId: string,
  visit: { href: string; title: string; opened: boolean },
): void {
  const key = dockHistoryKey(userId, teamId)
  const entries = parseDockHistory(readLocalStorage(key))
  const previous = entries.find((entry) => entry.href === visit.href)
  const opened = visit.opened || !previous

  if (!opened && previous.title === visit.title) return
  const now = Date.now()
  const entry = {
    href: visit.href,
    title: visit.title,
    count: (previous?.count ?? 0) + (opened ? 1 : 0),
    openedAt: opened ? now : previous.openedAt,
  }
  const next = [entry, ...entries.filter((item) => item.href !== visit.href)]

  next.sort(byFrecency(now))
  writeLocalStorage(key, JSON.stringify(next.slice(0, MAX_ENTRIES)))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }))
}

function searchText(entry: DockHistoryEntry): string {
  try {
    return `${entry.title} ${decodeURIComponent(entry.href)}`.toLocaleLowerCase()
  } catch {
    return `${entry.title} ${entry.href}`.toLocaleLowerCase()
  }
}

/** Pages matching every query term (title or path), most frecent first. */
export function searchDockHistory(
  entries: DockHistoryEntry[],
  query: string,
  now = Date.now(),
): DockHistoryEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)

  return entries
    .filter((entry) => terms.every((term) => searchText(entry).includes(term)))
    .sort(byFrecency(now))
}

export function readDockHistorySnapshot(key: string): string | null {
  return readLocalStorage(key)
}

export function subscribeDockHistory(key: string, listener: () => void): () => void {
  const onChange = (event: Event) => {
    if ((event as CustomEvent<string>).detail === key) listener()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener()
  }

  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}
