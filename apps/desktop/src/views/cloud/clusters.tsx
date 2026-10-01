import { useEffect } from 'react'

import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { AtlasCluster, AwsEcsCluster } from '../../types'

export function CloudClustersView({
  loader,
  filter,
  refreshKey,
  onCount,
  onPick,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<AtlasCluster>
  onPick: (c: AtlasCluster) => void
  getRowLink?: (c: AtlasCluster) => string
}) {
  const { pollTick } = useWorkspaceTab()
  const { items, loading, revalidating, error } = useResourceList(loader, refreshKey, onLoading, {
    pollTick,
  })

  const filtered = applyFilter(items, filter, (c) => `${c.name} ${c.region}`)
  // Never flash "No items" while a fetch is in flight with nothing to show —
  // keep the loading skeleton up until we actually have rows or a settled empty
  // result. (Cluster lists can be slow: a multi-region TKE scan takes seconds.)
  const showLoading = loading || (revalidating && filtered.length === 0)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { onRowContextMenu: onClusterContextMenu, menu: clusterMenu } =
    useLinkOnlyRowMenu(getRowLink)

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {clusterMenu}
      <Table<AtlasCluster>
        loading={showLoading}
        rows={filtered}
        rowKey={(r) => `${r.region}/${r.name}`}
        onPrimaryAction={onPick}
        onRowContextMenu={onClusterContextMenu}
        storageKey="cloud-clusters"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 280,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'region',
            header: 'Region',
            width: 140,
            sortAccessor: (r) => r.region,
            render: (r) => <span className="text-secondary">{r.region}</span>,
          },
          {
            key: 'version',
            header: 'Version',
            width: 110,
            sortAccessor: (r) => r.version ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.version || '-'}</span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            width: 110,
            sortAccessor: (r) => r.status ?? '',
            render: (r) => <StatusBadge status={r.status || 'Unknown'} />,
          },
          {
            key: 'age',
            header: 'Age',
            width: 100,
            sortAccessor: (r) => r.createdAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.createdAt ?? null} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}

export function EcsClustersView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
  onPick,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<AwsEcsCluster>
  onPick: (cluster: AwsEcsCluster) => void
  getRowLink?: (cluster: AwsEcsCluster) => string
}) {
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = applyFilter(
    items,
    filter,
    (c) => `${c.clusterName} ${c.status} ${c.region} ${c.capacityProviders.join(' ')}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { onRowContextMenu, menu: ecsMenu } = useLinkOnlyRowMenu(getRowLink)

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {ecsMenu}
      <Table<AwsEcsCluster>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.clusterArn}
        onPrimaryAction={onPick}
        onRowContextMenu={onRowContextMenu}
        storageKey="aws.ecs-clusters"
        defaultSort={{ key: 'clusterName', dir: 'asc' }}
        empty="No ECS clusters"
        columns={[
          {
            key: 'clusterName',
            header: 'Cluster Name',
            width: 260,
            sortAccessor: (r) => r.clusterName,
            render: (r) => <span className="font-medium text-zViolet-accent">{r.clusterName}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            width: 110,
            sortAccessor: (r) => r.status,
            render: (r) => <StatusBadge status={r.status} />,
          },
          {
            key: 'region',
            header: 'Region',
            width: 140,
            sortAccessor: (r) => r.region,
            render: (r) => (
              <span className="text-secondary font-mono text-[11.5px]">{r.region}</span>
            ),
          },
          {
            key: 'services',
            header: 'Services',
            width: 90,
            sortAccessor: (r) => r.activeServicesCount,
            render: (r) => <span className="text-secondary">{r.activeServicesCount}</span>,
          },
          {
            key: 'runningTasks',
            header: 'Running',
            width: 90,
            sortAccessor: (r) => r.runningTasksCount,
            render: (r) => <span className="text-secondary">{r.runningTasksCount}</span>,
          },
          {
            key: 'pendingTasks',
            header: 'Pending',
            width: 90,
            sortAccessor: (r) => r.pendingTasksCount,
            render: (r) => <span className="text-secondary">{r.pendingTasksCount}</span>,
          },
          {
            key: 'capacityProviders',
            header: 'Capacity Providers',
            width: 200,
            sortAccessor: (r) => r.capacityProviders.join(','),
            render: (r) => (
              <span className="text-secondary text-[11.5px]">
                {r.capacityProviders.length > 0 ? r.capacityProviders.join(', ') : '-'}
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
