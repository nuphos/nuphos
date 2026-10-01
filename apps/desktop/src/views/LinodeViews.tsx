import { useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import { Age } from '../components/Age'
import { ContextMenu } from '../components/ContextMenu'
import { LeafDetailPanel } from '../components/LeafDetailPanel'
import { StatusBadge } from '../components/StatusBadge'
import { Table } from '../components/Table'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { reportFrontendError } from '../lib/frontendErrorReporter'
import { withResourceListCache, resourceListCacheKey } from '../lib/resourceListCache'

import { applyFilter } from './linode/filter'
import { ErrorBlock } from './linode/shared'
import { useResourceList } from './useResourceList'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { LinodeInstance } from '../types'
import type { CommonProps } from './linode/shared'

export { LkeClustersView } from './linode/LkeClustersView'

export function LinodeInstancesView({
  teamId,
  accountId,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & { teamId: string; accountId: string }) {
  const [selected, setSelected] = useState<LinodeInstance | null>(null)
  const [menuState, setMenuState] = useState<{
    instance: LinodeInstance
    x: number
    y: number
  } | null>(null)
  const { pollTick } = useWorkspaceTab()
  const loader = useMemo(
    () =>
      withResourceListCache(resourceListCacheKey('linode', [teamId, accountId, 'instances']), () =>
        api.atlasListLinodeInstances(teamId, accountId),
      ),
    [teamId, accountId],
  )
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = applyFilter(
    items,
    filter,
    (i) => `${i.label} ${i.region} ${i.type} ${i.ipv4.join(' ')}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  const menuItems = (instance: LinodeInstance): ContextMenuItem[] => [
    {
      key: 'copy-label',
      label: 'Copy label',
      onSelect: () =>
        navigator.clipboard.writeText(instance.label).catch((cause: unknown) => {
          reportFrontendError(
            { source: 'clipboard', phase: 'linode_instance_name', message: 'Copy failed.' },
            cause,
          )
        }),
    },
    ...(instance.ipv4[0]
      ? [
          {
            key: 'copy-ip',
            label: 'Copy IP address',
            onSelect: () =>
              navigator.clipboard.writeText(instance.ipv4[0]!).catch((cause: unknown) => {
                reportFrontendError(
                  {
                    source: 'clipboard',
                    phase: 'linode_instance_address',
                    message: 'Copy failed.',
                  },
                  cause,
                )
              }),
          },
        ]
      : []),
  ]

  return (
    <>
      <Table
        loading={loading}
        columns={[
          {
            key: 'label',
            header: 'Label',
            render: (i) => <span className="font-mono text-[12px]">{i.label}</span>,
            sortAccessor: (i) => i.label,
          },
          {
            key: 'region',
            header: 'Region',
            render: (i) => <span className="text-secondary">{i.region}</span>,
            sortAccessor: (i) => i.region,
          },
          {
            key: 'type',
            header: 'Type',
            render: (i) => <span className="text-secondary text-[11.5px]">{i.type}</span>,
            sortAccessor: (i) => i.type,
          },
          {
            key: 'status',
            header: 'Status',
            render: (i) => <StatusBadge status={i.status} />,
            sortAccessor: (i) => i.status,
          },
          {
            key: 'ip',
            header: 'IP',
            render: (i) => (
              <span className="font-mono text-[11.5px] text-secondary">{i.ipv4[0] ?? '—'}</span>
            ),
            sortAccessor: (i) => i.ipv4[0] ?? '',
          },
          {
            key: 'age',
            header: 'Age',
            render: (i) =>
              i.created ? <Age value={i.created} /> : <span className="text-tertiary">—</span>,
            sortAccessor: (i) => i.created ?? '',
          },
        ]}
        rows={filtered}
        rowKey={(i) => String(i.id)}
        storageKey="linode.instances"
        defaultSort={{ key: 'label', dir: 'asc' }}
        onPrimaryAction={setSelected}
        onRowContextMenu={(instance, e) => setMenuState({ instance, x: e.clientX, y: e.clientY })}
      />
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={menuItems(menuState.instance)}
          onClose={() => setMenuState(null)}
        />
      )}
      {selected && (
        <LeafDetailPanel
          open
          onClose={() => setSelected(null)}
          title={selected.label}
          fields={[
            { label: 'ID', value: String(selected.id), mono: true },
            { label: 'Region', value: selected.region },
            { label: 'Type', value: selected.type },
            { label: 'Status', value: selected.status },
            { label: 'IPv4', value: selected.ipv4.join(', ') || '—', mono: true },
            { label: 'IPv6', value: selected.ipv6 ?? '—', mono: true },
            { label: 'Created', value: selected.created ?? '—' },
          ]}
        />
      )}
    </>
  )
}
