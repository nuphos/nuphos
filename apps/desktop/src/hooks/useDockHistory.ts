import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import {
  dockHistoryKey,
  parseDockHistory,
  readDockHistorySnapshot,
  recordDockVisit,
  subscribeDockHistory,
} from '../lib/dockHistory'

import type { WorkspaceTabState } from '../app/workspaceTabState'

export function useDockHistory(userId: string, teamId: string) {
  const key = dockHistoryKey(userId, teamId)
  const subscribe = useCallback(
    (listener: () => void) => subscribeDockHistory(key, listener),
    [key],
  )
  const getSnapshot = useCallback(() => readDockHistorySnapshot(key), [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null)

  return useMemo(() => parseDockHistory(snapshot), [snapshot])
}

// The page each tab last counted. Module-level so a pane remounting (switching
// conversations swaps the dock) does not count the same page as a new open.
const countedHrefByTab = new Map<string, string>()

/** Records every page a dock tab shows, so New Tab can offer it again. */
export function useRecordDockVisit(userId: string, tab: WorkspaceTabState) {
  const meta = tab.pageMeta
  const href = meta?.key === 'team.new-tab' ? undefined : meta?.location.href
  const title = meta?.title

  useEffect(() => {
    if (!href || !title) return
    const opened = countedHrefByTab.get(tab.id) !== href

    countedHrefByTab.set(tab.id, href)
    recordDockVisit(userId, tab.scope.teamId, { href, title, opened })
  }, [userId, tab.id, tab.scope.teamId, href, title])
}
