import { useCallback } from 'react'

import { selectedAwsRoleId, selectedGcpServiceAccountId } from '../accountScopes'

import type { KubernetesClusterSelection } from '../../lib/kubernetesCluster'
import type { AtlasCluster, AwsEcsCluster, CloudflareZone, Scope } from '../../types'
import type { AccountSet, WorkspaceTabState } from '../workspaceTabState'

export function useTabClusterPickers({
  tabId,
  tab,
  accounts,
  enterScopeInTab,
  enterCluster,
}: {
  tabId: string
  tab: WorkspaceTabState
  accounts: AccountSet | undefined
  enterScopeInTab: (tabId: string, next: Scope, defaultActive?: string) => void
  enterCluster: (params: KubernetesClusterSelection & { tabId?: string }) => void
}) {
  const onPickCloudflareZone = useCallback(
    (zone: CloudflareZone) => {
      if (tab.scope.kind !== 'cloudflare-account') return
      enterScopeInTab(tabId, {
        kind: 'cloudflare-zone',
        teamId: tab.scope.teamId,
        accountId: tab.scope.accountId,
        zoneId: zone.id,
        zoneName: zone.name,
      })
    },
    [enterScopeInTab, tab.scope, tabId],
  )
  const onPickCluster = useCallback(
    (cluster: AtlasCluster) => {
      if (tab.scope.kind === 'aws-account') {
        enterCluster({
          tabId,
          teamId: tab.scope.teamId,
          parentKind: 'aws-account',
          parentId: tab.scope.accountId,
          roleId: selectedAwsRoleId(tab.scope, accounts),
          cluster,
        })
      } else if (tab.scope.kind === 'gcp-project') {
        enterCluster({
          tabId,
          teamId: tab.scope.teamId,
          parentKind: 'gcp-project',
          parentId: tab.scope.projectId,
          serviceAccountId: selectedGcpServiceAccountId(tab.scope, accounts),
          cluster,
        })
      }
    },
    [accounts, enterCluster, tab.scope, tabId],
  )
  const onPickEcsCluster = useCallback(
    (cluster: AwsEcsCluster) => {
      if (tab.scope.kind !== 'aws-account') return
      enterScopeInTab(
        tabId,
        {
          kind: 'aws-ecs-cluster',
          teamId: tab.scope.teamId,
          accountId: tab.scope.accountId,
          roleId: selectedAwsRoleId(tab.scope, accounts),
          region: cluster.region,
          clusterName: cluster.clusterName,
          clusterArn: cluster.clusterArn,
          capacityProviders: cluster.capacityProviders,
        },
        'ecs.services',
      )
    },
    [accounts, enterScopeInTab, tab.scope, tabId],
  )

  return { onPickCloudflareZone, onPickCluster, onPickEcsCluster }
}
