import { useMemo } from 'react'

import { orderBrowserPanes } from './browserPaneOrder'
import { selectMountedBrowserTabs } from './store/workspaceState'

import type { WorkspaceTabState } from '../workspaceTabState'
import type { TabBucket } from './store/workspaceState'

/**
 * The panes the main pane renders, and which of them are mounted.
 *
 * A browser tab's state *is* its `<webview>`: Electron destroys the guest when
 * that element leaves the DOM, and moving it within the document reloads the
 * page. So browser panes are kept rendered even while their chat session is not
 * the current one, and they sit last, in creation order, so that tabs coming
 * and going ahead of them cannot move them — see `browserPaneOrder.ts`.
 *
 * Mounting still follows each tab's own session: a browser tab nobody has
 * opened yet is rendered like any other inactive tab, but stays unmounted so it
 * does not load a page on its own.
 */
export function usePaneOrder(
  tabs: readonly WorkspaceTabState[],
  buckets: Readonly<Record<string, TabBucket>>,
  activeTabId: string | null,
  mountedTabIds: ReadonlySet<string>,
): { panes: WorkspaceTabState[]; mountedIds: ReadonlySet<string> } {
  const panes = useMemo(() => {
    const browserTabs = new Map(selectMountedBrowserTabs(buckets).map((tab) => [tab.id, tab]))

    // The current session's browser tabs render whether or not they have been
    // opened, exactly as its other tabs do.
    for (const tab of tabs) if (tab.active === 'team.browser') browserTabs.set(tab.id, tab)

    return [
      ...tabs.filter((tab) => tab.active !== 'team.browser'),
      ...orderBrowserPanes([...browserTabs.values()]),
    ]
  }, [buckets, tabs])

  const mountedIds = useMemo(() => {
    const ids = new Set<string>()

    for (const tab of tabs) {
      if (tab.id === activeTabId || mountedTabIds.has(tab.id)) ids.add(tab.id)
    }
    for (const tab of selectMountedBrowserTabs(buckets)) ids.add(tab.id)

    return ids
  }, [tabs, activeTabId, mountedTabIds, buckets])

  return { panes, mountedIds }
}
