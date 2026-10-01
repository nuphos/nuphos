import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { LAST_SEEN_KEY, hasUnread, readStoredSlug, storeSlug } from '../lib/whatsNew'

import type { ChangelogEntry, ChangelogState } from '../types/team'

// ---- dev-only console trigger -------------------------------------------
// Inject a fake feed straight from devtools (same pattern as updateNotify):
//   changelogNotify([{ slug: 's1', title: 'Feature one', summary: 'Short pitch.',
//     date: '2026-08-12', coverUrl: 'https://placehold.co/264x120/png',
//     url: 'https://nuphos.ai/changelog/s1' }])
//   changelogNotify()  // clear the override
type DevListener = (entries: ChangelogEntry[] | null) => void
const devListeners = new Set<DevListener>()

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const changelogNotify = (entries?: ChangelogEntry[] | null) => {
    for (const listener of devListeners) listener(entries ?? null)
  }

  ;(window as unknown as { changelogNotify: typeof changelogNotify }).changelogNotify =
    changelogNotify
}

export type Changelog = {
  entries: ChangelogEntry[]
  unread: boolean
  markSeen: () => void
  readerEntry: ChangelogEntry | null
  openEntry: (entry: ChangelogEntry) => void
  closeReader: () => void
}

/** The website changelog feed (via the main process) plus read state; empty when unavailable. */
export function useChangelog(): Changelog {
  const [liveState, setLiveState] = useState<ChangelogState>({ kind: 'unavailable' })
  const [devEntries, setDevEntries] = useState<ChangelogEntry[] | null>(null)
  const liveEventTokenRef = useRef(0)
  const [lastSeen, setLastSeen] = useState(() => readStoredSlug(LAST_SEEN_KEY))
  const [readerEntry, setReaderEntry] = useState<ChangelogEntry | null>(null)
  const closeReader = useCallback(() => setReaderEntry(null), [])

  useEffect(() => {
    const off = api.onChangelogStatus((next) => {
      liveEventTokenRef.current += 1
      setLiveState(next)
    })
    const snapshotToken = liveEventTokenRef.current

    api
      .changelogGetState()
      .then((snapshot) => {
        if (snapshotToken === liveEventTokenRef.current) setLiveState(snapshot)
      })
      .catch(() => undefined)

    return off
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const listener: DevListener = (entries) => setDevEntries(entries)

    devListeners.add(listener)

    return () => {
      devListeners.delete(listener)
    }
  }, [])

  const entries = devEntries ?? (liveState.kind === 'ready' ? liveState.entries : [])
  const latest = entries.at(0)

  function markSeen() {
    if (!latest) return
    storeSlug(LAST_SEEN_KEY, latest.slug)
    setLastSeen(latest.slug)
  }

  return {
    entries,
    unread: hasUnread(entries, lastSeen),
    markSeen,
    readerEntry,
    openEntry: (entry) => {
      markSeen()
      setReaderEntry(entry)
    },
    closeReader,
  }
}
