import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { api } from '../../../api'
import { runtimeIsExecuting } from '../../../lib/runtimeExecution'

import { anchorDownloadGroups, shouldLoadTransferDownloads } from './transferDownloads'

import type { Tab } from './model'
import type { FileTransferGroup } from '../../../types'

// The groups each mounted transcript loaded, per chat, so other views of the
// chat (the chat summary) show the same files without asking again. An entry
// goes when its transcript unmounts, so the map holds only open chats.
const published = new Map<string, FileTransferGroup[]>()
const listeners = new Set<() => void>()
const NONE: FileTransferGroup[] = []

function publishTransferGroups(sessionId: string, groups: FileTransferGroup[]) {
  published.set(sessionId, groups)
  for (const listener of listeners) listener()
}

function unpublishTransferGroups(sessionId: string) {
  if (!published.delete(sessionId)) return
  for (const listener of listeners) listener()
}

function subscribeTransferGroups(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** The download groups the open transcript loaded for this chat; none for a chat it may not list. */
export function useSessionTransferGroups(sessionId: string): FileTransferGroup[] {
  return useSyncExternalStore(subscribeTransferGroups, () => published.get(sessionId) ?? NONE)
}

/**
 * Download cards for the files an agent produced, read straight from the
 * transfer store. They are deliberately not transcript state: the store already
 * holds them (and expires them), and a card written into the transcript could
 * not survive a turn — every turn rewrites the stored transcript from the
 * model-facing message list, which carries no UI-only parts.
 */
export function useTransferDownloads(
  tab: Tab,
  teamId: string | undefined,
  hasEarlier: boolean,
): Map<string, FileTransferGroup[]> {
  const executing = runtimeIsExecuting(tab.runtimeState)
  const [loaded, setLoaded] = useState<{ sessionId: string; groups: FileTransferGroup[] } | null>(
    null,
  )

  useEffect(() => {
    const sessionId = tab.sessionId

    return () => unpublishTransferGroups(sessionId)
  }, [tab.sessionId])

  useEffect(() => {
    if (!teamId || !shouldLoadTransferDownloads(tab)) return
    const sessionId = tab.sessionId
    let cancelled = false

    void api
      .fileTransferListDownloads({ teamId, sessionId })
      .then((res) => {
        if (cancelled) return
        setLoaded({ sessionId, groups: res.groups })
        publishTransferGroups(sessionId, res.groups)
      })
      .catch(() => {
        // Nothing to show is the right outcome; the card is not the answer.
      })

    return () => {
      cancelled = true
    }
    // Re-read when a turn settles: that is when new files have landed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, tab.sessionId, executing, tab.foreign, tab.messages.length])

  return useMemo(
    () =>
      anchorDownloadGroups(
        tab.messages,
        loaded?.sessionId === tab.sessionId ? loaded.groups : [],
        hasEarlier,
      ),
    [tab.messages, tab.sessionId, loaded, hasEarlier],
  )
}
