import { useCallback } from 'react'

import { api } from '../../api'
import { sidebarBackTarget } from '../../app/sidebarBackTarget'

import { selectActiveTab } from './store/workspaceState'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceAgentLinksResult } from './useWorkspaceAgentLinks'
import type { WorkspaceBreadcrumbResult } from './useWorkspaceBreadcrumb'
import type { WorkspaceClusterEntryResult } from './useWorkspaceClusterEntry'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceScopeActionsResult } from './useWorkspaceScopeActions'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceSidebarNavResult } from './useWorkspaceSidebarNav'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTakeoverResult } from './useWorkspaceTakeover'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceTeamsSyncResult } from './useWorkspaceTeamsSync'
import type { WorkspaceProps } from './workspaceProps'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceTeamsSyncResult &
  WorkspaceInvitationsResult &
  WorkspaceTeamResourcesResult &
  WorkspaceNamespacesResult &
  WorkspaceAccountsResult &
  WorkspaceScopeActionsResult &
  WorkspaceAgentLinksResult &
  WorkspaceTakeoverResult &
  WorkspaceClusterEntryResult &
  WorkspaceSidebarNavResult &
  WorkspaceBreadcrumbResult

export function useWorkspaceRefresh(a: Args) {
  const {
    breadcrumb,
    workspaceStore,
    scope,
    grafanaInstance,
    sshTerminal,
    sidebarActive,
    sidebarRepositoryNav,
    closedSshTabsRef,
    updateTab,
    updateActiveTab,
    invalidateNamespaces,
  } = a
  const reloadActiveSsh = useCallback(() => {
    const tab = selectActiveTab(workspaceStore.getState())

    if (!tab?.sshTerminal) return
    const ssh = tab.sshTerminal
    const teamId = tab.scope.teamId

    if (ssh.sessionId) void api.sshTerminalClose(ssh.sessionId)
    closedSshTabsRef.current.delete(tab.id)
    updateTab(tab.id, (cur) =>
      cur.sshTerminal
        ? {
            ...cur,
            sshTerminal: {
              ...cur.sshTerminal,
              sessionId: null,
              status: 'connecting',
              error: null,
            },
          }
        : cur,
    )

    let promise: Promise<{ id: string }> | null = null

    if (tab.scope.kind === 'aws-account' && tab.active === 'aws.ec2') {
      promise = api.atlasStartAwsEc2Ssh(teamId, tab.scope.accountId, ssh.instanceName, ssh.region)
    } else if (tab.scope.kind === 'aws-account' && tab.active === 'aws.lightsail') {
      promise = api.atlasStartAwsLightsailSsh(
        teamId,
        tab.scope.accountId,
        ssh.instanceName,
        ssh.region,
      )
    } else if (tab.scope.kind === 'gcp-project' && tab.active === 'gcp.gce') {
      promise = api.atlasStartGcpComputeSsh(
        teamId,
        tab.scope.projectId,
        ssh.instanceName,
        ssh.region,
      )
    }
    if (!promise) return

    promise
      .then((session) => {
        if (closedSshTabsRef.current.has(tab.id)) {
          closedSshTabsRef.current.delete(tab.id)
          void api.sshTerminalClose(session.id)

          return
        }
        updateTab(tab.id, (cur) =>
          cur.sshTerminal
            ? {
                ...cur,
                sshTerminal: {
                  ...cur.sshTerminal,
                  sessionId: session.id,
                  status: 'connected',
                  error: null,
                },
              }
            : cur,
        )
      })
      .catch((e: unknown) => {
        if (closedSshTabsRef.current.has(tab.id)) {
          closedSshTabsRef.current.delete(tab.id)

          return
        }
        const message = String(e instanceof Error ? e.message : e)

        updateTab(tab.id, (cur) =>
          cur.sshTerminal
            ? {
                ...cur,
                sshTerminal: {
                  ...cur.sshTerminal,
                  status: 'error',
                  error: message,
                },
              }
            : cur,
        )
      })
  }, [closedSshTabsRef, updateTab, workspaceStore])

  const onRefresh = useCallback(() => {
    if (sshTerminal) {
      reloadActiveSsh()

      return
    }
    // Refresh is the one place that should re-fetch the namespace picker: the
    // list is otherwise cached per (tab, cluster) so ordinary navigation and
    // namespace picks don't pay for it.
    const tab = selectActiveTab(workspaceStore.getState())

    if (tab) invalidateNamespaces(tab.id)
    updateActiveTab((cur) => ({ ...cur, refreshKey: cur.refreshKey + 1 }))
  }, [updateActiveTab, sshTerminal, reloadActiveSsh, invalidateNamespaces, workspaceStore])

  const teamSegment = breadcrumb[0]
  const sidebarBack = scope
    ? sidebarBackTarget(scope, sidebarActive, grafanaInstance, sidebarRepositoryNav)
    : null

  return {
    reloadActiveSsh,
    onRefresh,
    teamSegment,
    sidebarBack,
  }
}

export type WorkspaceRefreshResult = ReturnType<typeof useWorkspaceRefresh>
