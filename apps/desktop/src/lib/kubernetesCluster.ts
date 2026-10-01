import { api } from '../api'

import { getEndpointOverride } from './endpointOverrides'

import type { AtlasCluster, LkeCluster, OnpremCluster, Scope } from '../types'

type SelectionBase = {
  teamId: string
  parentId: string
}

export type KubernetesClusterSelection =
  | (SelectionBase & {
      parentKind: 'aws-account'
      roleId?: string
      cluster: AtlasCluster
    })
  | (SelectionBase & {
      parentKind: 'gcp-project'
      serviceAccountId?: string
      cluster: AtlasCluster
    })
  | (SelectionBase & {
      parentKind: 'linode-account'
      cluster: LkeCluster
    })
  | (SelectionBase & {
      parentKind: 'tencent-account' | 'aliyun-account' | 'volcengine-account'
      cluster: AtlasCluster
    })
  | (SelectionBase & {
      parentKind: 'onprem-cluster'
      cluster: OnpremCluster
    })

type ClusterScope = Extract<Scope, { kind: 'cluster' }>

export function clusterScopeFromSelection(selection: KubernetesClusterSelection): ClusterScope {
  const { teamId, parentKind, parentId, cluster } = selection

  switch (parentKind) {
    case 'onprem-cluster':
      return {
        kind: 'cluster',
        teamId,
        parentKind,
        parentId,
        clusterName: cluster.label,
        provider: 'onprem',
        region: 'onprem',
        onpremClusterId: cluster.id,
      }
    case 'linode-account':
      return {
        kind: 'cluster',
        teamId,
        parentKind,
        parentId,
        clusterName: cluster.label,
        provider: 'linode',
        region: cluster.region,
        linodeClusterId: cluster.id,
      }
    case 'tencent-account': {
      const tencentClusterId = cluster.tencentClusterId ?? cluster.name

      return {
        kind: 'cluster',
        teamId,
        parentKind,
        parentId,
        clusterName: cluster.name,
        provider: 'tencent',
        region: cluster.region,
        tencentClusterId,
      }
    }
    case 'aliyun-account': {
      const aliyunClusterId = cluster.aliyunClusterId ?? cluster.name

      return {
        kind: 'cluster',
        teamId,
        parentKind,
        parentId,
        clusterName: cluster.name,
        provider: 'aliyun',
        region: cluster.region,
        aliyunClusterId,
      }
    }
    case 'volcengine-account': {
      const volcengineClusterId = cluster.volcengineClusterId ?? cluster.name

      return {
        kind: 'cluster',
        teamId,
        parentKind,
        parentId,
        clusterName: cluster.name,
        provider: 'volcengine',
        region: cluster.region,
        volcengineClusterId,
      }
    }
    case 'aws-account':
      return {
        kind: 'cluster',
        teamId,
        parentKind,
        parentId,
        clusterName: cluster.name,
        provider: 'aws',
        region: cluster.region,
        ...(selection.roleId ? { roleId: selection.roleId } : {}),
      }
    case 'gcp-project':
      return {
        kind: 'cluster',
        teamId,
        parentKind,
        parentId,
        clusterName: cluster.name,
        provider: 'gcp',
        region: cluster.region,
        ...(selection.serviceAccountId ? { serviceAccountId: selection.serviceAccountId } : {}),
      }
  }
}

export async function connectKubernetesCluster(
  scope: ClusterScope,
  options: { fresh?: boolean } = {},
): Promise<{ context: string }> {
  switch (scope.provider) {
    case 'onprem':
      return api.atlasUseOnpremCluster(scope.teamId, scope.onpremClusterId)
    case 'aws':
      return api.atlasUseAwsCluster(
        scope.teamId,
        scope.parentId,
        scope.clusterName,
        scope.region,
        scope.roleId,
      )
    case 'gcp':
      return api.atlasUseGcpCluster(
        scope.teamId,
        scope.parentId,
        scope.clusterName,
        scope.region,
        scope.serviceAccountId,
      )
    case 'linode': {
      const override = getEndpointOverride(scope.parentId, scope.linodeClusterId)

      return override
        ? api.useClusterViaEndpoint(override, scope.clusterName)
        : api.atlasUseLinodeCluster(
            scope.teamId,
            scope.parentId,
            scope.linodeClusterId,
            scope.clusterName,
          )
    }
    case 'tencent':
      return api.atlasUseTencentCluster(
        scope.teamId,
        scope.parentId,
        scope.tencentClusterId,
        scope.region,
      )
    case 'aliyun':
      return api.atlasUseAliyunCluster(
        scope.teamId,
        scope.parentId,
        scope.aliyunClusterId,
        scope.region,
      )
    case 'volcengine':
      return api.atlasUseVolcengineCluster(
        scope.teamId,
        scope.parentId,
        scope.volcengineClusterId,
        scope.region,
        options.fresh,
      )
  }
}
