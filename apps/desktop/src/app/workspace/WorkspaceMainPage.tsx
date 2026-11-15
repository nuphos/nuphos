import { useMemo } from 'react'

import { externalPageLink } from '../../lib/externalPageLink'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'
import { pageLocationForTab } from '../workspaceTabFactory'

import { computeBreadcrumb } from './breadcrumb/computeBreadcrumb'
import { tabFields } from './tabFields'
import { usePageview } from './useWorkspaceActiveTab'
import { showsListControls, toolbarSegmentsOf, useToolbarSlots } from './useWorkspaceToolbar'
import { WorkspaceMainPane } from './WorkspaceMainPane'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { TabBucket } from './store/workspaceState'
import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'
import type { WorkspaceTabState } from '../workspaceTabState'

const NO_BUCKETS: Readonly<Record<string, TabBucket>> = {}
const NO_TABS: ReadonlySet<string> = new Set()

/**
 * A management page (Inbox, Archived, …) in the chat's place, with the dock
 * beside it as beside a chat. The workspace's own toolbar and tab state follow
 * the dock, so the page gets the same things derived from its own tab.
 */
export function WorkspaceMainPage({
  ws,
  user,
  tab,
}: {
  ws: WorkspaceController
  user: UserInfo
  tab: WorkspaceTabState
}) {
  const { updateTab, enterCluster } = ws
  const fields = tabFields(tab)
  const slots = useToolbarSlots()
  const tabs = useMemo(() => [tab], [tab])
  const externalLink = externalPageLink(tab)
  const breadcrumb = computeBreadcrumb(tab.scope, {
    ...ws,
    ...fields,
    agentSessionTitle: null,
    agentSessionId: null,
    agentSessionIcon: tab.pageMeta?.icon,
    updateActiveTab: (updater) => updateTab(tab.id, updater),
    enterCluster: (params) => {
      void enterCluster(params)
    },
  })

  usePageview(tab, useWorkspacePane()?.active ?? true)

  return (
    <WorkspaceMainPane
      mainPage
      user={user}
      ws={{
        ...ws,
        ...fields,
        ...slots,
        tabs,
        tabBuckets: NO_BUCKETS,
        activeTabId: tab.id,
        mountedTabIds: NO_TABS,
        activeTab: tab,
        scope: tab.scope,
        activeExternalLink: externalLink,
        toolbarPageUrl: externalLink?.url ?? toAbsoluteAtlasUrl(pageLocationForTab(tab).href),
        toolbarSegments: toolbarSegmentsOf(tab.active, breadcrumb),
        showListControls: showsListControls(tab.scope, fields),
        toolbarHasControls:
          Boolean(slots.toolbarPrimaryAction) ||
          slots.toolbarLeftOccupied ||
          slots.toolbarRightOccupied,
        // The search box rewrites the current history entry, as in the dock.
        setActiveFilter: (filter) =>
          updateTab(tab.id, (cur) => ({ ...cur, filter }), { history: 'replace' }),
        onRefresh: () => updateTab(tab.id, (cur) => ({ ...cur, refreshKey: cur.refreshKey + 1 })),
      }}
    />
  )
}
