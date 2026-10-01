import { useEffect, useState } from 'react'

import { LeafDetailPanel } from '../../components/LeafDetailPanel'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { Firewall } from '../../types'

function formatFirewallAllowed(firewall: Firewall): string {
  return (firewall.allowed ?? [])
    .map((a) => {
      const ports = a.ports ? `:${a.ports.join(',')}` : ''

      return `${a.protocol}${ports}`
    })
    .join(' ')
}

export function FirewallsView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<Firewall>
  getRowLink?: (firewall: Firewall) => string
}) {
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = applyFilter(items, filter, (f) => `${f.name} ${f.network ?? ''}`)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)
  const [detail, setDetail] = useState<Firewall | null>(null)

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {menu}
      {detail && (
        <LeafDetailPanel
          open
          onClose={() => setDetail(null)}
          title={detail.name}
          subtitle="Firewall rule"
          fields={[
            { label: 'Name', value: detail.name },
            { label: 'Direction', value: detail.direction || '—' },
            { label: 'Network', value: detail.network || '—', mono: true },
            { label: 'Priority', value: detail.priority ?? '—' },
            {
              label: 'Sources',
              value: (detail.sourceRanges ?? []).join(', ') || '—',
              mono: true,
            },
            {
              label: 'Allowed',
              full: true,
              mono: true,
              value: formatFirewallAllowed(detail) || '—',
            },
          ]}
          raw={detail}
        />
      )}
      <Table<Firewall>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.name}
        onPrimaryAction={setDetail}
        onRowContextMenu={onRowContextMenu}
        storageKey="firewalls"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 240,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'direction',
            header: 'Direction',
            width: 110,
            sortAccessor: (r) => r.direction ?? '',
            render: (r) => <span className="text-secondary">{r.direction || '-'}</span>,
          },
          {
            key: 'network',
            header: 'Network',
            width: 200,
            sortAccessor: (r) => r.network ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.network || '-'}</span>
            ),
          },
          {
            key: 'priority',
            header: 'Priority',
            width: 100,
            sortAccessor: (r) => r.priority ?? -1,
            render: (r) => r.priority ?? '-',
          },
          {
            key: 'sources',
            header: 'Sources',
            width: 200,
            sortAccessor: (r) => (r.sourceRanges ?? []).join(','),
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">
                {(r.sourceRanges ?? []).join(', ') || '-'}
              </span>
            ),
          },
          {
            key: 'allowed',
            header: 'Allowed',
            width: 220,
            sortAccessor: formatFirewallAllowed,
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">
                {formatFirewallAllowed(r) || '-'}
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
