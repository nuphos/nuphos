import { useCallback, useEffect } from 'react'

import { api } from '../../api'
import {
  clusterScopeClusterId,
  withStoredClusterNamespace,
  writeStoredClusterNamespace,
} from '../../app/clusterNamespaceStorage'
import { DEFAULT_KEY } from '../../lib/appRoutes'
import { clusterScopeFromSelection, connectKubernetesCluster } from '../../lib/kubernetesCluster'

import { selectActiveTab } from './store/workspaceState'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceAgentLinksResult } from './useWorkspaceAgentLinks'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceScopeActionsResult } from './useWorkspaceScopeActions'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTakeoverResult } from './useWorkspaceTakeover'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'
import type { KubernetesClusterSelection } from '../../lib/kubernetesCluster'

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
  WorkspaceTakeoverResult

export function useWorkspaceClusterEntry(a: Args) {
  const {
    setTeams,
    tabs,
    activeTabId,
    mountedTabIds,
    workspaceStore,
    setError,
    setCreateOrJoinOpen,
    setLandingCelebration,
    updateTab,
    switchTeam,
  } = a

  const openCreateTeam = useCallback(() => {
    setCreateOrJoinOpen(true)
  }, [setCreateOrJoinOpen])

  const createTeamAndEnter = useCallback(
    async (name: string) => {
      const team = await api.atlasCreateTeam(name)

      setTeams((prev) =>
        prev.some((existing) => existing.id === team.id) ? prev : [...prev, team],
      )
      setCreateOrJoinOpen(false)
      switchTeam(team.id)
      // A new workspace is born — celebrate it, same as the onboarding path.
      setLandingCelebration(true)
    },
    [setTeams, setCreateOrJoinOpen, switchTeam, setLandingCelebration],
  )

  const setClusterNamespaceInTab = useCallback(
    (tabId: string, ns: string) => {
      updateTab(tabId, (tab) => {
        if (tab.scope.kind !== 'cluster') return tab
        writeStoredClusterNamespace(tab.scope, ns)

        return {
          ...tab,
          scope: { ...tab.scope, namespace: ns || undefined },
          target: null,
          refreshKey: tab.refreshKey + 1,
        }
      })
    },
    [updateTab],
  )

  const setClusterNamespace = useCallback(
    (ns: string) => {
      const tab = selectActiveTab(workspaceStore.getState())

      if (tab) setClusterNamespaceInTab(tab.id, ns)
    },
    [setClusterNamespaceInTab, workspaceStore],
  )

  const enterCluster = useCallback(
    async (params: KubernetesClusterSelection & { tabId?: string }) => {
      const tabId = params.tabId ?? selectActiveTab(workspaceStore.getState())?.id

      if (!tabId) return
      const nextScope = withStoredClusterNamespace(clusterScopeFromSelection(params))

      setError(null)
      updateTab(tabId, (tab) => ({
        ...tab,
        switching: true,
        clusterLabel: nextScope.clusterName,
        kubeconfigContextError: null,
      }))
      try {
        const useResult = await connectKubernetesCluster(nextScope)

        updateTab(tabId, (tab) => {
          return {
            ...tab,
            scope: nextScope,
            active: DEFAULT_KEY.cluster,
            target: null,
            grafanaInstance: null,
            dashboardTarget: null,
            traceDatasourceTarget: null,
            logDatasourceTarget: null,
            filter: '',
            refreshKey: tab.refreshKey + 1,
            count: 0,
            viewLoading: false,
            kubeconfigContext: useResult.context,
            kubeconfigContextError: null,
            sshTerminal: null,
          }
        })
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e)

        setError(message)
        updateTab(tabId, (tab) => ({
          ...tab,
          clusterLabel: tab.scope.kind === 'cluster' ? tab.scope.clusterName : null,
          kubeconfigContextError: message,
        }))
      } finally {
        updateTab(tabId, (tab) => ({ ...tab, switching: false }))
      }
    },
    [setError, updateTab, workspaceStore],
  )

  // Auto-rehydrate `kubeconfigContext` for cluster-scoped tabs that don't have
  // one yet — happens on app start (we don't persist context across restarts,
  // only the cluster identifier) and on back/forward history navigation that
  // lands on a different cluster. Navigation within an already-connected
  // cluster preserves its context so cached lists can render immediately.
  //
  // Two safety guards:
  // 1. Setting `switching: true` synchronously deduplicates: on re-render the
  //    in-flight tab is skipped.
  // 2. On failure we stamp `kubeconfigContextError` and skip the tab on every
  //    subsequent render. Without this, the effect would refire on every state
  //    update — `tabs` is in its deps — and hammer the Nuphos API in a tight
  //    loop. The user clears the error by re-picking the cluster, which goes
  //    through `enterCluster` and resets the error.
  useEffect(() => {
    for (const tab of tabs) {
      const { scope } = tab

      if (scope.kind !== 'cluster') continue
      // Only rehydrate a cluster tab once its content is (or is about to be)
      // mounted. A restored-but-unvisited cluster tab waits until the user
      // switches to it, so app start spins up just the active tab's cluster
      // connection instead of every restored one at once.
      if (tab.id !== activeTabId && !mountedTabIds.has(tab.id)) continue
      if (tab.kubeconfigContext) continue
      if (tab.kubeconfigContextError) continue
      if (tab.switching) continue
      updateTab(tab.id, (t) => ({ ...t, switching: true }))
      void (async () => {
        try {
          const r = await connectKubernetesCluster(scope)

          // Compare the full scope identity — not just `clusterName` — so a
          // still-in-flight fetch for cluster "prod" in account A can't
          // overwrite a tab that has since been pointed at cluster "prod" in
          // account B (same name, different account).
          updateTab(tab.id, (t) => {
            const sameScope =
              t.scope.kind === 'cluster' &&
              t.scope.teamId === scope.teamId &&
              t.scope.parentKind === scope.parentKind &&
              t.scope.parentId === scope.parentId &&
              t.scope.roleId === scope.roleId &&
              t.scope.serviceAccountId === scope.serviceAccountId &&
              t.scope.region === scope.region &&
              clusterScopeClusterId(t.scope) === clusterScopeClusterId(scope)

            if (sameScope) {
              return {
                ...t,
                kubeconfigContext: r.context,
                kubeconfigContextError: null,
                switching: false,
              }
            }

            return { ...t, switching: false }
          })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)

          console.warn('[atlas] cluster context rehydrate failed:', e)
          // Mirror the success-path scope check: if the user has since
          // pointed this tab at a different cluster, the failure belongs to
          // the *old* scope and must not poison the new one's state. Always
          // clear `switching` so an in-flight tab can still be retried, but
          // only stamp the error message when the scope still matches.
          updateTab(tab.id, (t) => {
            const sameScope =
              t.scope.kind === 'cluster' &&
              t.scope.teamId === scope.teamId &&
              t.scope.parentKind === scope.parentKind &&
              t.scope.parentId === scope.parentId &&
              t.scope.region === scope.region &&
              clusterScopeClusterId(t.scope) === clusterScopeClusterId(scope)

            if (sameScope) {
              return { ...t, switching: false, kubeconfigContextError: message }
            }

            return { ...t, switching: false }
          })
        }
      })()
    }
  }, [tabs, updateTab, activeTabId, mountedTabIds])

  return {
    openCreateTeam,
    createTeamAndEnter,
    setClusterNamespace,
    enterCluster,
  }
}

export type WorkspaceClusterEntryResult = ReturnType<typeof useWorkspaceClusterEntry>
