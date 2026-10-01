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
import type { CloudflareZone } from '../../types'

export function CloudflareZonesView({
  loader,
  onPick,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<CloudflareZone>
  onPick: (zone: CloudflareZone) => void
  getRowLink?: (zone: CloudflareZone) => string
}) {
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = applyFilter(
    items,
    filter,
    (z) => `${z.name} ${z.status ?? ''} ${z.type ?? ''} ${z.nameServers.join(' ')}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {menu}
      <Table<CloudflareZone>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.id}
        onPrimaryAction={onPick}
        onRowContextMenu={onRowContextMenu}
        storageKey="cloudflare.zones"
        empty="No domains"
        columns={[
          {
            key: 'name',
            header: 'Domain',
            width: 260,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            width: 120,
            sortAccessor: (r) => r.status ?? '',
            render: (r) => <StatusBadge status={r.status || 'Unknown'} />,
          },
          {
            key: 'type',
            header: 'Plan',
            width: 110,
            sortAccessor: (r) => r.type ?? '',
            render: (r) => <span className="text-secondary">{r.type || '-'}</span>,
          },
          {
            key: 'paused',
            header: 'Paused',
            width: 90,
            sortAccessor: (r) => (r.paused ? 1 : 0),
            render: (r) => (r.paused ? <span className="text-amber-400">Yes</span> : '-'),
          },
          {
            key: 'nameservers',
            header: 'Name Servers',
            width: 360,
            sortAccessor: (r) => r.nameServers.join(','),
            render: (r) => (
              <span
                className="font-mono text-[12px] text-secondary truncate block max-w-[340px]"
                title={r.nameServers.join(', ') || undefined}
              >
                {r.nameServers.join(', ') || '-'}
              </span>
            ),
          },
          {
            key: 'updated',
            header: 'Updated',
            width: 100,
            sortAccessor: (r) => r.modifiedAt ?? r.createdAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.modifiedAt ?? r.createdAt} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
