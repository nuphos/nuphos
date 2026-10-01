import { useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import { Age } from '../components/Age'
import { ContextMenu } from '../components/ContextMenu'
import { LeafDetailPanel } from '../components/LeafDetailPanel'
import { StatusBadge } from '../components/StatusBadge'
import { Table } from '../components/Table'
import { useReportVisibleError } from '../components/VisibleErrorReporter'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { withResourceListCache, resourceListCacheKey } from '../lib/resourceListCache'
import { reportFrontendError } from '../lib/frontendErrorReporter'

import { useResourceList } from './useResourceList'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { HetznerServer } from '../types'

type CommonProps = {
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}

function applyFilter<T>(items: T[], filter: string, getText: (item: T) => string) {
  if (!filter) return items
  const f = filter.toLowerCase()

  return items.filter((x) => getText(x).toLowerCase().includes(f))
}

function ErrorBlock({ message }: { message: string }) {
  useReportVisibleError(message, 'hetzner_error_block')

  return <div className="p-8 text-error text-[13px]">{message}</div>
}

// Hetzner Cloud has no managed Kubernetes offering, so unlike Linode there is
// no clusters view here — servers are the only resource surfaced.
export function HetznerServersView({
  teamId,
  accountId,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & { teamId: string; accountId: string }) {
  const [selected, setSelected] = useState<HetznerServer | null>(null)
  const [menuState, setMenuState] = useState<{
    server: HetznerServer
    x: number
    y: number
  } | null>(null)
  const { pollTick } = useWorkspaceTab()
  const loader = useMemo(
    () =>
      withResourceListCache(resourceListCacheKey('hetzner', [teamId, accountId, 'servers']), () =>
        api.atlasListHetznerServers(teamId, accountId),
      ),
    [teamId, accountId],
  )
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = applyFilter(
    items,
    filter,
    (s) => `${s.name} ${s.location} ${s.serverType} ${s.ipv4 ?? ''}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  const menuItems = (server: HetznerServer): ContextMenuItem[] => [
    {
      key: 'copy-name',
      label: 'Copy name',
      onSelect: () =>
        navigator.clipboard.writeText(server.name).catch((cause: unknown) => {
          reportFrontendError(
            { source: 'clipboard', phase: 'hetzner_server_name', message: 'Copy failed.' },
            cause,
          )
        }),
    },
    ...(server.ipv4
      ? [
          {
            key: 'copy-ip',
            label: 'Copy IP address',
            onSelect: () =>
              navigator.clipboard.writeText(server.ipv4!).catch((cause: unknown) => {
                reportFrontendError(
                  { source: 'clipboard', phase: 'hetzner_server_address', message: 'Copy failed.' },
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
            key: 'name',
            header: 'Name',
            render: (s) => <span className="font-mono text-[12px]">{s.name}</span>,
            sortAccessor: (s) => s.name,
          },
          {
            key: 'location',
            header: 'Location',
            render: (s) => <span className="text-secondary">{s.location}</span>,
            sortAccessor: (s) => s.location,
          },
          {
            key: 'type',
            header: 'Type',
            render: (s) => <span className="text-secondary text-[11.5px]">{s.serverType}</span>,
            sortAccessor: (s) => s.serverType,
          },
          {
            key: 'status',
            header: 'Status',
            render: (s) => <StatusBadge status={s.status} />,
            sortAccessor: (s) => s.status,
          },
          {
            key: 'ip',
            header: 'IP',
            render: (s) => (
              <span className="font-mono text-[11.5px] text-secondary">{s.ipv4 ?? '—'}</span>
            ),
            sortAccessor: (s) => s.ipv4 ?? '',
          },
          {
            key: 'age',
            header: 'Age',
            render: (s) =>
              s.created ? <Age value={s.created} /> : <span className="text-tertiary">—</span>,
            sortAccessor: (s) => s.created ?? '',
          },
        ]}
        rows={filtered}
        rowKey={(s) => String(s.id)}
        storageKey="hetzner.servers"
        defaultSort={{ key: 'name', dir: 'asc' }}
        onPrimaryAction={setSelected}
        onRowContextMenu={(server, e) => setMenuState({ server, x: e.clientX, y: e.clientY })}
      />
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={menuItems(menuState.server)}
          onClose={() => setMenuState(null)}
        />
      )}
      {selected && (
        <LeafDetailPanel
          open
          onClose={() => setSelected(null)}
          title={selected.name}
          fields={[
            { label: 'ID', value: String(selected.id), mono: true },
            { label: 'Location', value: selected.location },
            { label: 'Type', value: selected.serverType },
            { label: 'Status', value: selected.status },
            { label: 'IPv4', value: selected.ipv4 ?? '—', mono: true },
            { label: 'IPv6', value: selected.ipv6 ?? '—', mono: true },
            { label: 'Created', value: selected.created ?? '—' },
          ]}
        />
      )}
    </>
  )
}
