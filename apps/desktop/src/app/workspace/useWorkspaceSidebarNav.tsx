import { useCallback, useMemo } from 'react'

import { sidebarKeyTabUpdate } from '../../app/workspace/sidebarKeyTabUpdate'
import { openEc2Ssh, openLightsailSsh } from '../../app/workspace/sshTabOpenAws'
import { openGceSsh } from '../../app/workspace/sshTabOpenGce'
import { restorePersistedTab } from '../../app/workspacePersistence'
import { pageLocationForTab, tabOpenedFrom } from '../../app/workspaceTabFactory'
import { isTeamManagementKey } from '../../lib/teamOverviewNav'

import { selectActiveTab, selectCurrentBucket, selectScope } from './store/workspaceState'

import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceAgentLinksResult } from './useWorkspaceAgentLinks'
import type { WorkspaceClusterEntryResult } from './useWorkspaceClusterEntry'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceScopeActionsResult } from './useWorkspaceScopeActions'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTakeoverResult } from './useWorkspaceTakeover'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'
import type { WorkspaceTabState } from '../../app/workspaceTabState'
import type { AwsEc2Instance, AwsLightsailInstance, GcpComputeInstance } from '../../types'

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
  WorkspaceClusterEntryResult

export function useWorkspaceSidebarNav(a: Args) {
  const focusSession = useWorkspacePane()?.focusSession
  const {
    workspaceStore,
    workspaceActions,
    grafanaInstancesByTeam,
    githubInstallationsByTeam,
    gitlabBindingsByTeam,
    gitlabNamespacesByTeam,
    setError,
    closedSshTabsRef,
    updateTab,
    updateActiveTab,
  } = a

  // The sidebar's navigation as a pure tab transform, so the same key can be
  // applied to the active tab (a normal sidebar click) or to a fresh tab (a
  // Favorites click, which opens rather than replaces).
  const sidebarKeyTabUpdater = useCallback(
    (key: string) => (tab: WorkspaceTabState) =>
      sidebarKeyTabUpdate(key, tab, {
        grafanaInstancesByTeam,
        githubInstallationsByTeam,
        gitlabBindingsByTeam,
        gitlabNamespacesByTeam,
      }),
    [
      githubInstallationsByTeam,
      grafanaInstancesByTeam,
      gitlabBindingsByTeam,
      gitlabNamespacesByTeam,
    ],
  )

  const openManagementPage = useCallback(
    (key: string) => {
      const teamId = selectScope(workspaceStore.getState())?.teamId

      if (!teamId) return
      workspaceActions.openMainPage(teamId)
      updateActiveTab(sidebarKeyTabUpdater(key))
    },
    [sidebarKeyTabUpdater, updateActiveTab, workspaceActions, workspaceStore],
  )

  // Chats and management pages are what the main pane shows; every other key
  // navigates the page it was triggered from, or opens beside it on cmd-click.
  const onSidebarOpenKey = useCallback(
    (key: string, favoriteLabel: string | null, newTab: boolean) => {
      const sessionId = /^agent-session:(.+)$/.exec(key)?.[1]

      if (sessionId || key === 'team.agent') {
        const teamId = selectScope(workspaceStore.getState())?.teamId

        if (sessionId && focusSession?.(sessionId, teamId)) return
        workspaceActions.selectSession(sessionId ?? null)

        return
      }
      if (isTeamManagementKey(key)) {
        openManagementPage(key)

        return
      }

      if (!newTab) {
        updateActiveTab((tab) => {
          const next = sidebarKeyTabUpdater(key)(tab)

          if (!favoriteLabel) return next

          return {
            ...next,
            favoriteTitle: { title: favoriteLabel, href: pageLocationForTab(next).href },
          }
        })

        return
      }
      const state = workspaceStore.getState()
      const { tabs } = selectCurrentBucket(state)
      const source = selectActiveTab(state) ?? tabs.at(0)

      if (!source) return
      // Clone the current tab the way "Duplicate tab" does — fresh id, runtime
      // state reset — before applying the key. Some sidebar keys resolve against
      // the tab they act on (a Grafana instance, a GitHub nav), so a bare team
      // tab would lose that context.
      const seed = restorePersistedTab({
        navHistory: source.navHistory,
        navHistoryIndex: source.navHistoryIndex,
        title: source.pageMeta?.title ?? source.restoredTitle,
      })

      if (!seed) return
      const next = tabOpenedFrom(source, sidebarKeyTabUpdater(key)(seed))
      const targetHref = pageLocationForTab(next).href
      const favoriteTitle = favoriteLabel ? { title: favoriteLabel, href: targetHref } : null
      const existing = tabs.find((tab) => pageLocationForTab(tab).href === targetHref)

      if (existing) {
        if (favoriteTitle) updateTab(existing.id, (tab) => ({ ...tab, favoriteTitle }))
        workspaceActions.activateTab(existing.id)

        return
      }
      workspaceActions.openTab({ ...next, favoriteTitle })
    },
    [
      focusSession,
      openManagementPage,
      sidebarKeyTabUpdater,
      updateActiveTab,
      updateTab,
      workspaceActions,
      workspaceStore,
    ],
  )
  const onSidebarSelect = useCallback(
    (key: string) => onSidebarOpenKey(key, null, false),
    [onSidebarOpenKey],
  )

  const openConversationHere = useCallback(
    (sessionId: string) => {
      if (sessionId) workspaceActions.selectSession(sessionId)
    },
    [workspaceActions],
  )

  const sshTabContext = useMemo(
    () => ({ closedSshTabsRef, setError, openTab: workspaceActions.openTab, updateTab }),
    [closedSshTabsRef, setError, updateTab, workspaceActions],
  )

  const openLightsailSshTab = useCallback(
    (params: {
      teamId: string
      accountId: string
      roleId?: string
      instance: AwsLightsailInstance
    }) => openLightsailSsh(sshTabContext, params),
    [sshTabContext],
  )

  const openEc2SshTab = useCallback(
    (params: { teamId: string; accountId: string; roleId?: string; instance: AwsEc2Instance }) =>
      openEc2Ssh(sshTabContext, params),
    [sshTabContext],
  )

  const openGceSshTab = useCallback(
    (params: {
      teamId: string
      projectId: string
      serviceAccountId?: string
      instance: GcpComputeInstance
    }) => openGceSsh(sshTabContext, params),
    [sshTabContext],
  )

  return {
    onSidebarSelect,
    onSidebarOpenKey,
    openConversationHere,
    openLightsailSshTab,
    openEc2SshTab,
    openGceSshTab,
  }
}

export type WorkspaceSidebarNavResult = ReturnType<typeof useWorkspaceSidebarNav>
