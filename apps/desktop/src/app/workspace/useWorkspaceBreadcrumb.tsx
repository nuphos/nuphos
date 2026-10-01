import { useMemo } from 'react'

import { computeBreadcrumb } from './breadcrumb/computeBreadcrumb'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceAgentLinksResult } from './useWorkspaceAgentLinks'
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
import type { BreadcrumbSegment } from '../../components/Toolbar'

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
  WorkspaceSidebarNavResult

export function useWorkspaceBreadcrumb(a: Args) {
  const {
    teams,
    databaseConnectionsByTeam,
    clustersByParent,
    lkeClustersByAccount,
    ec2InstancesByAccount,
    lightsailInstancesByAccount,
    gceInstancesByProject,
    grafanaInstancesByTeam,
    activeTab,
    scope,
    active,
    filter,
    target,
    s3Detail,
    architectureDetail,
    nuphosDashboard,
    nuphosDashboards,
    connectorDetail,
    triggerDetail,
    triggerForm,
    agentSessionTitle,
    awsDetail,
    cloudflareDetail,
    grafanaInstance,
    dashboardTarget,
    traceDatasourceTarget,
    logDatasourceTarget,
    sshTerminal,
    githubNav,
    repoProvider,
    clusterLabel,
    updateActiveTab,
    refreshTeamsSilently,
    loadEc2InstancesForAccount,
    loadLightsailInstancesForAccount,
    loadGceInstancesForProject,
    accounts,
    loadLkeClustersForAccount,
    enterScope,
    switchTeam,
    enterCluster,
    onSidebarSelect,
    openLightsailSshTab,
    openEc2SshTab,
    openGceSshTab,
  } = a

  const breadcrumb: BreadcrumbSegment[] = useMemo(
    () =>
      computeBreadcrumb(scope, {
        active,
        filter,
        target,
        s3Detail,
        architectureDetail,
        nuphosDashboard,
        nuphosDashboards,
        connectorDetail,
        triggerDetail,
        triggerForm,
        agentSessionTitle,
        agentSessionId: activeTab?.agentSessionId ?? null,
        linearNav: activeTab?.linearNav ?? null,
        awsDetail,
        cloudflareDetail,
        updateActiveTab,
        teams,
        accounts,
        clusterLabel,
        enterScope,
        switchTeam,
        enterCluster: (params) => {
          void enterCluster(params)
        },
        clustersByParent,
        lkeClustersByAccount,
        loadLkeClustersForAccount,
        refreshTeamsSilently,
        grafanaInstance,
        dashboardTarget,
        traceDatasourceTarget,
        logDatasourceTarget,
        githubNav,
        repoProvider,
        grafanaInstancesByTeam,
        onSidebarSelect,
        sshTerminal,
        ec2InstancesByAccount,
        lightsailInstancesByAccount,
        gceInstancesByProject,
        loadEc2InstancesForAccount,
        loadLightsailInstancesForAccount,
        loadGceInstancesForProject,
        openEc2SshTab,
        openLightsailSshTab,
        openGceSshTab,
        databaseConnectionsByTeam,
      }),
    [
      scope,
      active,
      filter,
      target,
      s3Detail,
      architectureDetail,
      nuphosDashboard,
      nuphosDashboards,
      connectorDetail,
      triggerDetail,
      triggerForm,
      agentSessionTitle,
      activeTab?.agentSessionId,
      activeTab?.linearNav,
      awsDetail,
      cloudflareDetail,
      updateActiveTab,
      teams,
      accounts,
      clusterLabel,
      enterScope,
      switchTeam,
      enterCluster,
      clustersByParent,
      lkeClustersByAccount,
      loadLkeClustersForAccount,
      refreshTeamsSilently,
      grafanaInstance,
      dashboardTarget,
      traceDatasourceTarget,
      logDatasourceTarget,
      githubNav,
      repoProvider,
      grafanaInstancesByTeam,
      onSidebarSelect,
      sshTerminal,
      ec2InstancesByAccount,
      lightsailInstancesByAccount,
      gceInstancesByProject,
      loadEc2InstancesForAccount,
      loadLightsailInstancesForAccount,
      loadGceInstancesForProject,
      openEc2SshTab,
      openLightsailSshTab,
      openGceSshTab,
      databaseConnectionsByTeam,
    ],
  )

  return {
    breadcrumb,
  }
}

export type WorkspaceBreadcrumbResult = ReturnType<typeof useWorkspaceBreadcrumb>
