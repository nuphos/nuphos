import { pushNavigation, replaceNavigation } from '../../../lib/navHistory.ts'
import { isFreshTeamTab, navigationSnapshot } from '../../workspaceTabFactory.ts'

import { MAIN_PAGE_BUCKET_KEY } from './workspaceState.ts'

import type { OpenTabOptions, TabHistoryMode, TabUpdater } from './workspaceActions'
import type { TabBucket } from './workspaceState'
import type { WorkspaceTabState } from '../../workspaceTabState'
import type { TabDropPlacement } from '../tabs/tabsTypes'

export function openTabIn(
  bucket: TabBucket,
  tab: WorkspaceTabState,
  options: OpenTabOptions = {},
): TabBucket {
  const { tabs } = bucket
  const replaceLone =
    options.replaceLoneFreshTab === true &&
    tabs.length === 1 &&
    tabs[0].id === bucket.activeTabId &&
    isFreshTeamTab(tabs[0])
  let next: WorkspaceTabState[]

  if (replaceLone) {
    next = [tab]
  } else {
    const anchor = options.afterTabId
      ? tabs.findIndex((item) => item.id === options.afterTabId)
      : -1

    next =
      anchor < 0 ? [...tabs, tab] : [...tabs.slice(0, anchor + 1), tab, ...tabs.slice(anchor + 1)]
  }

  return {
    ...bucket,
    tabs: next,
    activeTabId: tab.id,
    dockOpen: options.openDock ? true : bucket.dockOpen,
  }
}

export function activateTabIn(bucket: TabBucket, tabId: string): TabBucket {
  if (bucket.activeTabId === tabId || !bucket.tabs.some((tab) => tab.id === tabId)) return bucket

  return { ...bucket, activeTabId: tabId }
}

/** Keeps a tab mounted without showing it, as a phone watching its page needs. */
export function mountTabIn(bucket: TabBucket, tabId: string): TabBucket {
  if (bucket.mountedTabIds.has(tabId) || !bucket.tabs.some((tab) => tab.id === tabId)) return bucket

  return { ...bucket, mountedTabIds: new Set([...bucket.mountedTabIds, tabId]) }
}

/** Closing the last tab closes the dock and leaves the session with no tabs;
 *  reopening the dock seeds a fresh one. */
export function closeTabIn(bucket: TabBucket, tabId: string): TabBucket {
  const index = bucket.tabs.findIndex((tab) => tab.id === tabId)

  if (index < 0) return bucket
  if (bucket.tabs.length === 1) return { ...bucket, tabs: [], activeTabId: null, dockOpen: false }
  const tabs = bucket.tabs.filter((tab) => tab.id !== tabId)
  const activeTabId =
    bucket.activeTabId === tabId ? (tabs[Math.max(0, index - 1)]?.id ?? null) : bucket.activeTabId

  return { ...bucket, tabs, activeTabId }
}

export function closeOtherTabsIn(bucket: TabBucket, tabId: string): TabBucket {
  const keep = bucket.tabs.find((tab) => tab.id === tabId)

  if (!keep || bucket.tabs.length <= 1) return bucket

  return { ...bucket, tabs: [keep], activeTabId: keep.id }
}

export function reorderTabIn(
  bucket: TabBucket,
  tabId: string,
  targetTabId: string,
  placement: TabDropPlacement,
): TabBucket {
  const tab = bucket.tabs.find((item) => item.id === tabId)

  if (!tab || tabId === targetTabId) return bucket
  const rest = bucket.tabs.filter((item) => item.id !== tabId)
  const targetIndex = rest.findIndex((item) => item.id === targetTabId)

  if (targetIndex < 0) return bucket
  const insertAt = placement === 'after' ? targetIndex + 1 : targetIndex

  return { ...bucket, tabs: [...rest.slice(0, insertAt), tab, ...rest.slice(insertAt)] }
}

export function selectAdjacentIn(bucket: TabBucket, direction: -1 | 1): TabBucket {
  const { tabs, activeTabId } = bucket
  const index = tabs.findIndex((tab) => tab.id === activeTabId)

  if (tabs.length <= 1 || index < 0) return bucket

  return activateTabIn(bucket, tabs[(index + direction + tabs.length) % tabs.length].id)
}

export function selectTabAtIn(bucket: TabBucket, position: number | 'last'): TabBucket {
  const target = position === 'last' ? bucket.tabs.at(-1) : bucket.tabs[position]

  return target ? activateTabIn(bucket, target.id) : bucket
}

export function mapTabsIn(bucket: TabBucket, updater: TabUpdater): TabBucket {
  const tabs = bucket.tabs.map(updater)

  return tabs.every((tab, index) => tab === bucket.tabs[index]) ? bucket : { ...bucket, tabs }
}

/**
 * The one place a tab's state changes, and therefore the one place history is
 * recorded: an update that lands the tab on a different page is a navigation.
 * `replace` refines the current page, `restore` is back/forward moving the
 * cursor itself, and SSH terminal tabs opt out — their location is the PTY.
 */
export function updateTabIn(
  bucket: TabBucket,
  tabId: string,
  updater: TabUpdater,
  history?: TabHistoryMode,
): TabBucket {
  return mapTabsIn(bucket, (tab) => {
    if (tab.id !== tabId) return tab
    const updated = updater(tab)

    if (updated === tab || history === 'restore' || updated.sshTerminal) return updated
    const record = history === 'replace' ? replaceNavigation : pushNavigation

    return { ...updated, ...record(updated, navigationSnapshot(updated)) }
  })
}

export function retainTeamsIn(bucket: TabBucket, keep: (teamId: string) => boolean): TabBucket {
  const tabs = bucket.tabs.filter((tab) => keep(tab.scope.teamId))

  return tabs.length === bucket.tabs.length ? bucket : { ...bucket, tabs }
}

/**
 * Takes in the docks of a split pane that is closing, so their tabs (and the
 * terminals behind them) keep running here instead of ending with the pane.
 * A chat both panes hold keeps this pane's strip first; the main page stays
 * this pane's own.
 */
export function adoptBucketsIn(
  buckets: Readonly<Record<string, TabBucket>>,
  incoming: Readonly<Record<string, TabBucket>>,
): Readonly<Record<string, TabBucket>> {
  let next: Record<string, TabBucket> | null = null

  for (const [key, bucket] of Object.entries(incoming)) {
    if (key === MAIN_PAGE_BUCKET_KEY || bucket.tabs.length === 0) continue
    const existing = buckets[key] as TabBucket | undefined
    const ids = new Set(existing?.tabs.map((tab) => tab.id))
    const added = bucket.tabs.filter((tab) => !ids.has(tab.id))

    if (existing && added.length === 0) continue
    next ??= { ...buckets }
    next[key] = existing
      ? {
          ...existing,
          tabs: [...existing.tabs, ...added],
          mountedTabIds: new Set([
            ...existing.mountedTabIds,
            ...added.filter((tab) => bucket.mountedTabIds.has(tab.id)).map((tab) => tab.id),
          ]),
        }
      : bucket
  }

  return next ?? buckets
}
