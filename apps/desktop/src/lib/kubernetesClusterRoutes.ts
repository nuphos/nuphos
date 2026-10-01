import type { Scope } from '../types'

export type KubernetesClusterProvider =
  'aws' | 'gcp' | 'linode' | 'tencent' | 'aliyun' | 'volcengine' | 'onprem'

const KUBERNETES_CLUSTER_PROVIDERS: Record<KubernetesClusterProvider, true> = {
  aws: true,
  gcp: true,
  linode: true,
  tencent: true,
  aliyun: true,
  volcengine: true,
  onprem: true,
}

export function isKubernetesClusterProvider(value: string): value is KubernetesClusterProvider {
  return Object.hasOwn(KUBERNETES_CLUSTER_PROVIDERS, value)
}

export type KubernetesClusterRoute = {
  teamId: string
  provider: KubernetesClusterProvider
  connectionId: string
  region: string
  clusterId: string
  /** AWS role or GCP service-account binding. Never a secret. */
  credentialId?: string
}

type ClusterScope = Extract<Scope, { kind: 'cluster' }>

export function clusterIdForScope(scope: ClusterScope): string {
  switch (scope.provider) {
    case 'linode':
      return String(scope.linodeClusterId)
    case 'tencent':
      return scope.tencentClusterId
    case 'aliyun':
      return scope.aliyunClusterId
    case 'volcengine':
      return scope.volcengineClusterId
    case 'onprem':
      return scope.onpremClusterId
    case 'aws':
    case 'gcp':
      return scope.clusterName
  }
}

export function clusterRouteForScope(scope: ClusterScope): KubernetesClusterRoute {
  const credentialId =
    scope.parentKind === 'aws-account'
      ? scope.roleId
      : scope.parentKind === 'gcp-project'
        ? scope.serviceAccountId
        : undefined

  return {
    teamId: scope.teamId,
    provider: scope.provider,
    connectionId: scope.parentId,
    region: scope.region,
    clusterId: clusterIdForScope(scope),
    ...(credentialId ? { credentialId } : {}),
  }
}

export function clusterScopeFromRoute(route: KubernetesClusterRoute): ClusterScope | null {
  const { teamId, provider, connectionId: parentId, region, clusterId, credentialId } = route

  switch (provider) {
    case 'aws':
      return {
        kind: 'cluster',
        teamId,
        parentKind: 'aws-account',
        parentId,
        clusterName: clusterId,
        provider,
        region,
        ...(credentialId ? { roleId: credentialId } : {}),
      }
    case 'gcp':
      return {
        kind: 'cluster',
        teamId,
        parentKind: 'gcp-project',
        parentId,
        clusterName: clusterId,
        provider,
        region,
        ...(credentialId ? { serviceAccountId: credentialId } : {}),
      }
    case 'linode': {
      if (!/^\d+$/.test(clusterId)) return null
      const linodeClusterId = Number(clusterId)

      if (!Number.isSafeInteger(linodeClusterId) || linodeClusterId <= 0) return null

      return {
        kind: 'cluster',
        teamId,
        parentKind: 'linode-account',
        parentId,
        clusterName: clusterId,
        provider,
        region,
        linodeClusterId,
      }
    }
    case 'tencent':
      return {
        kind: 'cluster',
        teamId,
        parentKind: 'tencent-account',
        parentId,
        clusterName: clusterId,
        provider,
        region,
        tencentClusterId: clusterId,
      }
    case 'aliyun':
      return {
        kind: 'cluster',
        teamId,
        parentKind: 'aliyun-account',
        parentId,
        clusterName: clusterId,
        provider,
        region,
        aliyunClusterId: clusterId,
      }
    case 'volcengine':
      return {
        kind: 'cluster',
        teamId,
        parentKind: 'volcengine-account',
        parentId,
        clusterName: clusterId,
        provider,
        region,
        volcengineClusterId: clusterId,
      }
    case 'onprem':
      return {
        kind: 'cluster',
        teamId,
        parentKind: 'onprem-cluster',
        parentId,
        clusterName: clusterId,
        provider,
        region: 'onprem',
        onpremClusterId: clusterId,
      }
  }
}
