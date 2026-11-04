import { searchDockHistory } from '../../../lib/dockHistory.ts'
import { teamOverviewNavItemFor } from '../../../lib/teamOverviewNav.ts'
import { pageLocationForTab } from '../../workspaceTabFactory.ts'

import { sessionKeyOf } from './workspaceState.ts'

import type { WorkspaceState } from './workspaceState'
import type { DockHistoryEntry } from '../../../lib/dockHistory'

/** One tab in a conversation's dock, any page: a browser tab, a terminal, Files, a desktop. */
export type DockTabEntry = {
  id: string
  /** The tab's page key, e.g. `team.browser` or `team.terminal`. */
  kind: string
  title: string
  /** The app path the tab shows, as New Tab and history name pages. */
  href: string
  /** A browser tab's web address. */
  url?: string
}

/** A page from the Mac's dock history, as New Tab's Recent and its search list it. */
export type DockRecentEntry = { href: string; title: string; url?: string }

/** What the iPhone mirrors of a conversation's dock: its tabs, the one in front, and Recent. */
export type DockMirror = {
  tabs: DockTabEntry[]
  activeTabId: string | null
  recent: DockRecentEntry[]
}

/** Enough of the dock history for the phone's search as well as its Recent rows. */
const RECENT_LIMIT = 50

const browserUrlOf = (href: string) =>
  new URLSearchParams(href.split('?')[1]).get('url') ?? undefined

/**
 * The conversation's dock as the Mac shows it, without its own New Tab pages
 * (the phone has its own), and the dock history New Tab offers, most frecent
 * first. Both come from what the Mac already keeps: the workspace store and
 * the per-team dock history in localStorage.
 */
export function dockMirror(
  state: WorkspaceState,
  sessionId: string,
  history: DockHistoryEntry[],
  now = Date.now(),
): DockMirror {
  const bucket = state.buckets[sessionKeyOf(sessionId)]
  const tabs = (bucket?.tabs ?? [])
    .filter((tab) => tab.active !== 'team.new-tab')
    .map((tab): DockTabEntry => {
      const title =
        tab.pageMeta?.title ?? tab.restoredTitle ?? teamOverviewNavItemFor(tab.active)?.label ?? ''

      return {
        id: tab.id,
        kind: tab.active,
        title,
        href: pageLocationForTab(tab).href,
        ...(tab.active === 'team.browser' && tab.browserUrl ? { url: tab.browserUrl } : {}),
      }
    })
  const recent = searchDockHistory(history, '', now)
    .slice(0, RECENT_LIMIT)
    .map((entry): DockRecentEntry => {
      const url = browserUrlOf(entry.href)

      return { href: entry.href, title: entry.title, ...(url ? { url } : {}) }
    })

  return { tabs, activeTabId: bucket?.activeTabId ?? null, recent }
}
