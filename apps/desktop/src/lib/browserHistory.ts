import { readLocalStorage, writeLocalStorage } from '../app/localStorage.ts'

export type BrowserHistoryEntry = { url: string; title: string; visitedAt: number }
const MAX_ENTRIES = 500
const CHANGE_EVENT = 'nuphos:browser-history'

export function browserHistoryKey(userId: string, teamId: string): string {
  return `nuphos.browserHistory.${encodeURIComponent(userId)}.${encodeURIComponent(teamId)}`
}

export function parseBrowserHistory(raw: string | null): BrowserHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')

    if (!Array.isArray(value)) return []

    return value
      .filter(
        (entry: unknown): entry is BrowserHistoryEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          'url' in entry &&
          'title' in entry &&
          'visitedAt' in entry &&
          typeof entry.url === 'string' &&
          /^https?:\/\//i.test(entry.url) &&
          typeof entry.title === 'string' &&
          typeof entry.visitedAt === 'number' &&
          Number.isFinite(entry.visitedAt),
      )
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

export function recordBrowserVisit(
  userId: string,
  teamId: string,
  url: string,
  title: string,
): void {
  if (!/^https?:\/\//i.test(url)) return
  const key = browserHistoryKey(userId, teamId)
  const entries = parseBrowserHistory(readLocalStorage(key))
  const previous = entries.find((entry) => entry.url === url)
  const entry = { url, title: title.trim() || previous?.title || url, visitedAt: Date.now() }

  writeLocalStorage(
    key,
    JSON.stringify([entry, ...entries.filter((item) => item.url !== url)].slice(0, MAX_ENTRIES)),
  )
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }))
}

export function readBrowserHistorySnapshot(key: string): string | null {
  return readLocalStorage(key)
}

export function subscribeBrowserHistory(key: string, listener: () => void): () => void {
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

export function searchBrowserHistory(
  entries: BrowserHistoryEntry[],
  query: string,
): BrowserHistoryEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)

  if (terms.length === 0) return []

  return entries
    .filter((entry) => {
      const text = `${entry.title} ${entry.url}`.toLocaleLowerCase()

      return terms.every((term) => text.includes(term))
    })
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, 10)
}
