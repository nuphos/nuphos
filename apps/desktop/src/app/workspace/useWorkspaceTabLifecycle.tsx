import { useCallback, useEffect } from 'react'

import { api } from '../../api'
import { restorePersistedTab } from '../../app/workspacePersistence'
import { logNewTabRequested } from '../../lib/tabSwitchLog'
import { collectLocalTerminalTabIds, planSshTeardownForLogout } from '../../lib/terminalTabTeardown'

import {
  selectAllResidentTabs,
  selectCurrentBucket,
  selectTabLocation,
} from './store/workspaceState'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceAgentLinksResult } from './useWorkspaceAgentLinks'
import type { WorkspaceBreadcrumbResult } from './useWorkspaceBreadcrumb'
import type { WorkspaceChatLinksResult } from './useWorkspaceChatLinks'
import type { WorkspaceClusterEntryResult } from './useWorkspaceClusterEntry'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceLinkOpenersResult } from './useWorkspaceLinkOpeners'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceScopeActionsResult } from './useWorkspaceScopeActions'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceSidebarNavResult } from './useWorkspaceSidebarNav'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTakeoverResult } from './useWorkspaceTakeover'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceToolbarResult } from './useWorkspaceToolbar'
import type { WorkspaceProps } from './workspaceProps'
import type { PersistedWorkspaceTab } from '../../app/workspacePersistence'
import type { WorkspaceTabState } from '../../app/workspaceTabState'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceInvitationsResult &
  WorkspaceTeamResourcesResult &
  WorkspaceNamespacesResult &
  WorkspaceAccountsResult &
  WorkspaceScopeActionsResult &
  WorkspaceAgentLinksResult &
  WorkspaceTakeoverResult &
  WorkspaceClusterEntryResult &
  WorkspaceSidebarNavResult &
  WorkspaceBreadcrumbResult &
  WorkspaceToolbarResult &
  WorkspaceLinkOpenersResult &
  WorkspaceChatLinksResult

// Remember a closing tab's persistable navigation for ⌘⇧T reopen. The cap
// keeps the stack from growing unbounded.
function pushClosedTabSnapshot(
  stack: (PersistedWorkspaceTab & { closedId: string })[],
  closing: WorkspaceTabState,
) {
  if (stack.at(-1)?.closedId === closing.id) return
  stack.push({
    closedId: closing.id,
    navHistory: closing.navHistory,
    navHistoryIndex: closing.navHistoryIndex,
    title: closing.pageMeta?.title ?? closing.restoredTitle,
  })
  if (stack.length > 10) stack.shift()
}

export function useWorkspaceTabLifecycle(a: Args) {
  const pane = useWorkspacePane()
  const paneActive = pane?.active ?? true
  const closePane = pane?.closePane
  const isTabFocused = pane?.isTabFocused
  const {
    onLogout,
    setWorkspaceDockExpanded,
    workspaceStore,
    workspaceActions,
    closedTabSnapshotsRef,
    closedSshTabsRef,
    toolbarPrimaryAction,
    toolbarLeftOccupied,
    toolbarRightOccupied,
    newTab,
  } = a
  const { closeOtherTabs, reorderTab, selectAdjacentTab } = workspaceActions

  // Logout unmounts the workspace instead of emptying the tab strips, so the
  // teardown observer never sees these tabs go — tear every session's
  // terminals down here.
  const handleLogout = useCallback(() => {
    const residentTabs = selectAllResidentTabs(workspaceStore.getState())
    const plan = planSshTeardownForLogout(residentTabs)

    for (const tabId of plan.closedTabIds) closedSshTabsRef.current.add(tabId)
    for (const sessionId of plan.sessionIdsToClose) void api.sshTerminalClose(sessionId)
    for (const tabId of collectLocalTerminalTabIds(residentTabs)) {
      void api.localTerminalClose(tabId)
    }
    // Every tab is leaving, so nothing is in scope any more — this also deletes
    // any node-shell pod still open.
    for (const tab of residentTabs) void api.podExecCloseTabScope(tab.id, null)
    void onLogout()
  }, [closedSshTabsRef, onLogout, workspaceStore])

  const closeTab = useCallback(
    (tabId: string) => {
      const closing = selectTabLocation(workspaceStore.getState(), tabId)?.tab

      if (!closing) return
      pushClosedTabSnapshot(closedTabSnapshotsRef.current, closing)
      workspaceActions.closeTab(tabId)
    },
    [closedTabSnapshotsRef, workspaceActions, workspaceStore],
  )

  const duplicateTab = useCallback(
    (tabId: string) => {
      const src = selectTabLocation(workspaceStore.getState(), tabId)?.tab

      if (!src) return
      // Reuse the persist/restore path to clone the navigation into a fresh tab:
      // new id, runtime state (SSH PTY, kubeconfig context, loading flags) reset,
      // navigation history copied.
      const clone = restorePersistedTab({
        navHistory: src.navHistory,
        navHistoryIndex: src.navHistoryIndex,
        title: src.pageMeta?.title ?? src.restoredTitle,
      })

      if (clone) workspaceActions.openTab(clone, { afterTabId: tabId })
    },
    [workspaceActions, workspaceStore],
  )

  // Whether the toolbar's controls row has anything to show — a published
  // primary action, or a view that has portaled its own controls into a slot.
  // Drives the row's visibility so it never renders as an empty band (e.g. a
  // drilled-in diagram with no controls).
  const toolbarHasControls =
    Boolean(toolbarPrimaryAction) || toolbarLeftOccupied || toolbarRightOccupied

  useEffect(() => {
    if (!paneActive || typeof window.api.onAppShortcut !== 'function') return
    const off = window.api.onAppShortcut((action) => {
      if (action === 'new-tab') {
        logNewTabRequested('cmd+t')
        newTab()
      } else if (action === 'close-tab') {
        const { activeTabId } = selectCurrentBucket(workspaceStore.getState())

        if (isTabFocused?.()) {
          if (activeTabId) closeTab(activeTabId)

          return
        }
        if (closePane) {
          setWorkspaceDockExpanded(false)
          closePane()

          return
        }
        if (activeTabId) closeTab(activeTabId)
      } else if (action === 'previous-tab') {
        selectAdjacentTab(-1)
      } else if (action === 'next-tab') {
        selectAdjacentTab(1)
      }
    })

    return off
  }, [
    paneActive,
    closePane,
    isTabFocused,
    closeTab,
    newTab,
    selectAdjacentTab,
    setWorkspaceDockExpanded,
    workspaceStore,
  ])

  useEffect(() => {
    if (!paneActive) return
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return
      if (e.code === 'BracketLeft' || e.key === '[' || e.key === '{') {
        e.preventDefault()
        selectAdjacentTab(-1)
      } else if (e.code === 'BracketRight' || e.key === ']' || e.key === '}') {
        e.preventDefault()
        selectAdjacentTab(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paneActive, selectAdjacentTab])

  return {
    handleLogout,
    closeTab,
    duplicateTab,
    closeOtherTabs,
    reorderTab,
    toolbarHasControls,
  }
}

export type WorkspaceTabLifecycleResult = ReturnType<typeof useWorkspaceTabLifecycle>
