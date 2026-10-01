import { Container, Server } from 'lucide-react'

import { api } from '../../api'
import { resourceListCacheKey, withResourceListCache } from '../../lib/resourceListCache'
import {
  AliyunEcsInstancesView,
  AliyunSwasInstancesView,
  CloudClustersView,
  TencentCvmInstancesView,
  VolcengineEcsInstancesView,
} from '../../views/CloudViews'
import { HetznerServersView } from '../../views/HetznerViews'
import { LinodeInstancesView, LkeClustersView } from '../../views/LinodeViews'

import type { ScopeRenderContext } from './context'

export function renderProviderAccountPages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    filter,
    refreshKey,
    onCount,
    onLoading,
    enterCluster,
    renderActiveNavPage,
  } = ctx

  if (scope.kind === 'linode-account') {
    if (active === 'linode.lke') {
      return renderActiveNavPage(
        'LKE Clusters',
        <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <LkeClustersView
          teamId={scope.teamId}
          accountId={scope.accountId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          onUseCluster={(cluster) => {
            enterCluster({
              teamId: scope.teamId,
              parentKind: 'linode-account',
              parentId: scope.accountId,
              cluster,
            })
          }}
        />,
      )
    }

    return renderActiveNavPage(
      'Linodes',
      <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <LinodeInstancesView
        teamId={scope.teamId}
        accountId={scope.accountId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  if (scope.kind === 'hetzner-account') {
    return renderActiveNavPage(
      'Servers',
      <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <HetznerServersView
        teamId={scope.teamId}
        accountId={scope.accountId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  if (scope.kind === 'tencent-account') {
    const accountId = scope.accountId
    const teamId = scope.teamId

    if (active === 'tencent.cvm') {
      return renderActiveNavPage(
        'CVM Instances',
        <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <TencentCvmInstancesView
          loader={withResourceListCache(
            resourceListCacheKey('tencent', [teamId, accountId, 'cvm-instances']),
            () => api.atlasListTencentCvmInstances(teamId, accountId),
          )}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }

    return renderActiveNavPage(
      'TKE Clusters',
      <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CloudClustersView
        loader={withResourceListCache(
          resourceListCacheKey('tencent', [teamId, accountId, 'clusters']),
          () => api.atlasListTencentClusters(teamId, accountId),
        )}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onPick={(cluster) => {
          enterCluster({ teamId, parentKind: 'tencent-account', parentId: accountId, cluster })
        }}
      />,
    )
  }

  if (scope.kind === 'aliyun-account') {
    const accountId = scope.accountId
    const teamId = scope.teamId

    if (active === 'aliyun.ecs') {
      return renderActiveNavPage(
        'ECS Instances',
        <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <AliyunEcsInstancesView
          loader={withResourceListCache(
            resourceListCacheKey('aliyun', [teamId, accountId, 'ecs-instances']),
            () => api.atlasListAliyunEcsInstances(teamId, accountId),
          )}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }
    if (active === 'aliyun.swas') {
      return renderActiveNavPage(
        'Simple Application Server',
        <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <AliyunSwasInstancesView
          loader={withResourceListCache(
            resourceListCacheKey('aliyun', [teamId, accountId, 'swas-instances']),
            () => api.atlasListAliyunSwasInstances(teamId, accountId),
          )}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }

    return renderActiveNavPage(
      'ACK Clusters',
      <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CloudClustersView
        loader={withResourceListCache(
          resourceListCacheKey('aliyun', [teamId, accountId, 'clusters']),
          () => api.atlasListAliyunClusters(teamId, accountId),
        )}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onPick={(cluster) => {
          enterCluster({ teamId, parentKind: 'aliyun-account', parentId: accountId, cluster })
        }}
      />,
    )
  }

  if (scope.kind === 'volcengine-account') {
    const accountId = scope.accountId
    const teamId = scope.teamId

    if (active === 'volcengine.ecs') {
      return renderActiveNavPage(
        'ECS Instances',
        <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <VolcengineEcsInstancesView
          loader={withResourceListCache(
            resourceListCacheKey('volcengine', [teamId, accountId, 'ecs-instances']),
            () => api.atlasListVolcengineEcsInstances(teamId, accountId),
          )}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }

    return renderActiveNavPage(
      'VKE Clusters',
      <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CloudClustersView
        loader={withResourceListCache(
          resourceListCacheKey('volcengine', [teamId, accountId, 'clusters']),
          () => api.atlasListVolcengineClusters(teamId, accountId),
        )}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onPick={(cluster) => {
          enterCluster({ teamId, parentKind: 'volcengine-account', parentId: accountId, cluster })
        }}
      />,
    )
  }

  return undefined
}
