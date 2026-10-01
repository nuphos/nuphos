import { Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { GcpComputeInstance } from '../../types'

export function GCEInstancesView({
  loader,
  onOpenSsh,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<GcpComputeInstance>
  onOpenSsh: (instance: GcpComputeInstance) => void
  getRowLink?: (instance: GcpComputeInstance) => string
}) {
  const [menu, setMenu] = useState<{ instance: GcpComputeInstance; x: number; y: number } | null>(
    null,
  )
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const linkActions = useRowLinkActions(getRowLink)

  function buildInstanceMenu(instance: GcpComputeInstance): ContextMenuItem[] {
    const running = instance.status === 'RUNNING'
    const canSsh = running && Boolean(instance.publicIp)
    const linkItems = linkActions(instance)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'ssh',
        label: 'SSH',
        icon: Terminal,
        disabled: !canSsh,
        hint: !running ? instance.status : !instance.publicIp ? 'no public IP' : undefined,
        onSelect: () => onOpenSsh(instance),
      },
    ]
  }

  const filtered = applyFilter(
    items,
    filter,
    (i) => `${i.name} ${i.zone} ${i.machineType} ${i.publicIp ?? ''} ${i.privateIp ?? ''}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildInstanceMenu(menu.instance)}
          onClose={() => setMenu(null)}
        />
      )}
      <Table<GcpComputeInstance>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.zone}/${r.name}`}
        onRowContextMenu={(instance, e) => setMenu({ instance, x: e.clientX, y: e.clientY })}
        storageKey="gcp.gce-instances"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 220,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            width: 110,
            sortAccessor: (r) => r.status,
            render: (r) => <StatusBadge status={r.status || 'Unknown'} />,
          },
          {
            key: 'zone',
            header: 'Zone',
            width: 150,
            sortAccessor: (r) => r.zone,
            render: (r) => <span className="text-secondary">{r.zone}</span>,
          },
          {
            key: 'machineType',
            header: 'Machine Type',
            width: 150,
            sortAccessor: (r) => r.machineType,
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.machineType}</span>
            ),
          },
          {
            key: 'publicIp',
            header: 'External IP',
            width: 140,
            sortAccessor: (r) => r.publicIp ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.publicIp ?? '-'}</span>
            ),
          },
          {
            key: 'privateIp',
            header: 'Internal IP',
            width: 140,
            sortAccessor: (r) => r.privateIp ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.privateIp ?? '-'}</span>
            ),
          },
          {
            key: 'network',
            header: 'Network',
            width: 150,
            sortAccessor: (r) => r.network ?? '',
            render: (r) => <span className="text-secondary">{r.network ?? '-'}</span>,
          },
          {
            key: 'age',
            header: 'Age',
            width: 100,
            sortAccessor: (r) => r.createdAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.createdAt} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
