import { useCallback, useEffect } from 'react'

import { api } from '../../api'
import { selectedAwsRoleId, selectedGcpServiceAccountId } from '../../app/accountScopes'
import { toast } from '../../components/ui/toast'
import { hasCloudOnboardingBinding } from '../../lib/connectorCategories'
import { mergeIfChanged } from '../../lib/mergeIfChanged'
import type {} from '../../types'

import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceInvitationsResult &
  WorkspaceTeamResourcesResult &
  WorkspaceNamespacesResult

export function useWorkspaceAccounts(a: Args) {
  const {
    accountsByTeam,
    setDatabaseConnectionsByTeam,
    clustersByParent,
    setClustersByParent,
    lkeClustersByAccount,
    setLkeClustersByAccount,
    ec2InstancesByAccount,
    lightsailInstancesByAccount,
    gceInstancesByProject,
    firstRunDevForced,
    scope,
    active,
    refreshKey,
    sshTerminal,
    loadEc2InstancesForAccount,
    loadLightsailInstancesForAccount,
    loadGceInstancesForProject,
    teamId,
  } = a

  const accounts = teamId ? accountsByTeam[teamId] : undefined
  const firstRunCloudUnbound =
    firstRunDevForced ||
    (teamId !== undefined && accounts !== undefined && !hasCloudOnboardingBinding(accounts))

  useEffect(() => {
    if (!teamId) return
    let cancelled = false
    let requestVersion = 0
    const load = () => {
      const version = ++requestVersion

      void api
        .atlasListDatabaseConnections(teamId)
        .then((connections) => {
          if (!cancelled && version === requestVersion) {
            setDatabaseConnectionsByTeam((prev) => mergeIfChanged(prev, teamId, connections))
          }
        })
        .catch((cause: unknown) => {
          if (cancelled || version !== requestVersion) return
          setDatabaseConnectionsByTeam((prev) => ({ ...prev, [teamId]: [] }))
          toast.apiError('Failed to load databases', cause)
        })
    }

    load()
    window.addEventListener('nuphos:databases-changed', load)

    return () => {
      cancelled = true
      window.removeEventListener('nuphos:databases-changed', load)
    }
  }, [teamId, refreshKey, setDatabaseConnectionsByTeam])

  useEffect(() => {
    if (!scope) return
    let parentKind:
      | 'aws-account'
      | 'gcp-project'
      | 'tencent-account'
      | 'aliyun-account'
      | 'volcengine-account'
      | null = null
    let parentId: string | null = null

    if (scope.kind === 'aws-account') {
      parentKind = 'aws-account'
      parentId = scope.accountId
    } else if (scope.kind === 'gcp-project') {
      parentKind = 'gcp-project'
      parentId = scope.projectId
    } else if (scope.kind === 'tencent-account') {
      parentKind = 'tencent-account'
      parentId = scope.accountId
    } else if (scope.kind === 'aliyun-account') {
      parentKind = 'aliyun-account'
      parentId = scope.accountId
    } else if (scope.kind === 'volcengine-account') {
      parentKind = 'volcengine-account'
      parentId = scope.accountId
    } else if (
      scope.kind === 'cluster' &&
      scope.parentKind !== 'linode-account' &&
      scope.parentKind !== 'onprem-cluster'
    ) {
      // aws / gcp / tencent / aliyun cluster parents share this AtlasCluster[]
      // cache; linode keeps its own (lkeClustersByAccount).
      parentKind = scope.parentKind
      parentId = scope.parentId
    }
    if (!parentKind || !parentId) return
    const roleId =
      scope.kind === 'aws-account'
        ? selectedAwsRoleId(scope, accounts)
        : scope.kind === 'cluster' && scope.parentKind === 'aws-account'
          ? scope.roleId
          : undefined
    const serviceAccountId =
      scope.kind === 'gcp-project'
        ? selectedGcpServiceAccountId(scope, accounts)
        : scope.kind === 'cluster' && scope.parentKind === 'gcp-project'
          ? scope.serviceAccountId
          : undefined
    const cacheKey = `${parentKind}/${parentId}/${roleId ?? serviceAccountId ?? 'auto'}`

    if (clustersByParent[cacheKey]) return
    let cancelled = false
    const fetcher =
      parentKind === 'aws-account'
        ? api.atlasListAwsClusters(scope.teamId, parentId, roleId)
        : parentKind === 'tencent-account'
          ? api.atlasListTencentClusters(scope.teamId, parentId)
          : parentKind === 'aliyun-account'
            ? api.atlasListAliyunClusters(scope.teamId, parentId)
            : parentKind === 'volcengine-account'
              ? api.atlasListVolcengineClusters(scope.teamId, parentId)
              : api.atlasListGcpClusters(scope.teamId, parentId, serviceAccountId)

    fetcher
      .then((items) => {
        if (cancelled) return
        setClustersByParent((prev) => ({ ...prev, [cacheKey]: items }))
      })
      .catch(() => {
        if (cancelled) return
        // Mark as loaded-empty on failure so the breadcrumb sibling picker stops
        // spinning (undefined reads as "still loading"); a later nav re-fetches.
        setClustersByParent((prev) =>
          prev[cacheKey] === undefined ? { ...prev, [cacheKey]: [] } : prev,
        )
      })

    return () => {
      cancelled = true
    }
  }, [scope, accounts, clustersByParent, setClustersByParent])

  // Fetch sibling LKE clusters for the breadcrumb picker. Invoked eagerly by
  // the effect below and on every picker open (onExpand), so a transient
  // failure is retried the next time the user opens the dropdown instead of
  // being cached for the whole session.
  const loadLkeClustersForAccount = useCallback(
    (teamId: string, accountId: string) => {
      const key = `${teamId}/${accountId}`

      api
        .atlasListLkeClusters(teamId, accountId)
        .then((items) => setLkeClustersByAccount((p) => ({ ...p, [key]: items })))
        .catch((err: unknown) => {
          // Park an empty list only when there's nothing cached yet: it stops
          // the picker spinner and keeps the eager effect from refetching in a
          // loop. With data already cached, stale options beat an empty menu.
          setLkeClustersByAccount((prev) =>
            prev[key] === undefined ? { ...prev, [key]: [] } : prev,
          )
          toast.apiError('Failed to load LKE clusters', err)
        })
    },
    [setLkeClustersByAccount],
  )

  // Populate the LKE sibling cache while on a Linode account or inside one of
  // its clusters, so the breadcrumb cluster picker has options ready.
  useEffect(() => {
    if (!scope) return
    const accountId =
      scope.kind === 'linode-account'
        ? scope.accountId
        : scope.kind === 'cluster' && scope.parentKind === 'linode-account'
          ? scope.parentId
          : null

    if (!accountId) return
    if (lkeClustersByAccount[`${scope.teamId}/${accountId}`]) return
    loadLkeClustersForAccount(scope.teamId, accountId)
  }, [scope, lkeClustersByAccount, loadLkeClustersForAccount])

  // Eagerly populate the sibling-instances cache when the user enters an SSH
  // tab so the breadcrumb instance dropdown shows real options instead of a
  // perpetual loading spinner. The lazy onExpand path is kept as a fallback /
  // refresh-on-click.
  useEffect(() => {
    if (!sshTerminal || !scope) return
    // Unlike `loadLkeClustersForAccount`, these three loaders park their
    // placeholder synchronously — that placeholder is the "already requested"
    // marker this effect's guards read, so it cannot move into the promise.
    // Starting them from the effect body therefore cascades a second render
    // inside the same commit; kick them off once the commit has drained.
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      if (scope.kind === 'aws-account' && active === 'aws.ec2') {
        const key = `${scope.teamId}/${scope.accountId}`

        if (ec2InstancesByAccount[key] === undefined) {
          loadEc2InstancesForAccount(scope.teamId, scope.accountId)
        }
      } else if (scope.kind === 'aws-account' && active === 'aws.lightsail') {
        const key = `${scope.teamId}/${scope.accountId}`

        if (lightsailInstancesByAccount[key] === undefined) {
          loadLightsailInstancesForAccount(scope.teamId, scope.accountId)
        }
      } else if (scope.kind === 'gcp-project' && active === 'gcp.gce') {
        const key = `${scope.teamId}/${scope.projectId}`

        if (gceInstancesByProject[key] === undefined) {
          loadGceInstancesForProject(scope.teamId, scope.projectId)
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    sshTerminal,
    scope,
    active,
    ec2InstancesByAccount,
    lightsailInstancesByAccount,
    gceInstancesByProject,
    loadEc2InstancesForAccount,
    loadLightsailInstancesForAccount,
    loadGceInstancesForProject,
  ])

  return {
    accounts,
    firstRunCloudUnbound,
    loadLkeClustersForAccount,
  }
}

export type WorkspaceAccountsResult = ReturnType<typeof useWorkspaceAccounts>
