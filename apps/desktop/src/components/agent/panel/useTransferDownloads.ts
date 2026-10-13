import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../api'
import { runtimeIsExecuting } from '../../../lib/runtimeExecution'

import { anchorDownloadGroups, shouldLoadTransferDownloads } from './transferDownloads'

import type { Tab } from './model'
import type { FileTransferGroup } from '../../../types'

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
): Map<string, FileTransferGroup[]> {
  const executing = runtimeIsExecuting(tab.runtimeState)
  const [loaded, setLoaded] = useState<{ sessionId: string; groups: FileTransferGroup[] } | null>(
    null,
  )

  useEffect(() => {
    if (!teamId || !shouldLoadTransferDownloads(tab)) return
    const sessionId = tab.sessionId
    let cancelled = false

    void api
      .fileTransferListDownloads({ teamId, sessionId })
      .then((res) => {
        if (!cancelled) setLoaded({ sessionId, groups: res.groups })
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
      anchorDownloadGroups(tab.messages, loaded?.sessionId === tab.sessionId ? loaded.groups : []),
    [tab.messages, tab.sessionId, loaded],
  )
}
