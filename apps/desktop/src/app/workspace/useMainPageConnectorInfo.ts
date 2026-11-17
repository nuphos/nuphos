import { useCallback } from 'react'

import { EMPTY_LIST } from '../workspaceTabState'

import { selectActiveTab } from './store/workspaceState'
import { useTabConnectorActions } from './useTabConnectorActions'
import { useTabDetailSetters } from './useTabDetailSetters'
import { useTabViewSetters } from './useTabViewSetters'
import { enterScopeTabUpdate } from './useWorkspaceScopeActions'

import type { UpdateWorkspaceTab } from './paneTypes'
import type { TabUpdater } from './store/workspaceActions'
import type { WorkspaceController } from './useWorkspaceController'
import type { KubernetesClusterSelection } from '../../lib/kubernetesCluster'
import type { Scope } from '../../types'
import type { ConnectorInfoContext } from '../scopeContent/connectorInfoActions'

/**
 * What a connector's detail can open, bound to the main page. Resource pages
 * (an AWS account, a cluster, a repository, …) are pages, not dialog content:
 * opening one closes the dialog and lands the main page's tab there, the way
 * the Connectors page used to navigate its own tab.
 */
export function useMainPageConnectorInfo(
  ws: WorkspaceController,
  teamId: string,
  close: () => void,
): Omit<ConnectorInfoContext, 'connectorDetail' | 'onAccountsChanged'> {
  const { workspaceActions, workspaceStore, stableEnterCluster } = ws
  const navigateMainPage = useCallback(
    (updater: TabUpdater) => {
      close()
      workspaceActions.openMainPage(teamId, updater)
    },
    [close, teamId, workspaceActions],
  )
  const enterScopeInMainPage = useCallback(
    (_tabId: string, next: Scope, defaultActive?: string) =>
      navigateMainPage((tab) => enterScopeTabUpdate(tab, next, defaultActive)),
    [navigateMainPage],
  )
  // Team pages (repositories, dashboards, Linear) open in the team scope,
  // wherever the main page last was.
  const updateMainPageTab = useCallback<UpdateWorkspaceTab>(
    (_tabId, updater) =>
      navigateMainPage((tab) =>
        updater(
          tab.scope.kind === 'team'
            ? tab
            : enterScopeTabUpdate(tab, { kind: 'team', teamId: tab.scope.teamId }, tab.active),
        ),
      ),
    [navigateMainPage],
  )
  const enterCluster = useCallback(
    (params: KubernetesClusterSelection & { tabId?: string }) => {
      close()
      workspaceActions.openMainPage(teamId)
      stableEnterCluster({ ...params, tabId: selectActiveTab(workspaceStore.getState())?.id })
    },
    [close, stableEnterCluster, teamId, workspaceActions, workspaceStore],
  )
  const scope: Scope = { kind: 'team', teamId }
  const connectorActions = useTabConnectorActions({
    tabId: '',
    tab: { scope },
    enterScopeInTab: enterScopeInMainPage,
  })
  const viewSetters = useTabViewSetters('', updateMainPageTab)
  const { setLinearNav } = useTabDetailSetters('', updateMainPageTab)

  return {
    ...connectorActions,
    ...viewSetters,
    setLinearNav,
    enterCluster,
    scope,
    accounts: ws.accounts,
    databaseConnections: ws.databaseConnectionsByTeam[teamId],
    githubInstallations: ws.githubInstallationsByTeam[teamId] ?? EMPTY_LIST,
    gitlabBindings: ws.gitlabBindingsByTeam[teamId] ?? EMPTY_LIST,
    grafanaInstances: ws.grafanaInstancesByTeam[teamId] ?? EMPTY_LIST,
  }
}
