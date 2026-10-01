import { useEffect, useState } from 'react'

import { LeafDetailPanel } from '../../components/LeafDetailPanel'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { Nacl, Vpc } from '../../types'

export function VpcsView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<Vpc>
  getRowLink?: (vpc: Vpc) => string
}) {
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = applyFilter(items, filter, (v) => `${v.id} ${v.name ?? ''} ${v.cidr ?? ''}`)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)
  const [detail, setDetail] = useState<Vpc | null>(null)

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {menu}
      {detail && (
        <LeafDetailPanel
          open
          onClose={() => setDetail(null)}
          title={detail.name || detail.id}
          subtitle="VPC"
          fields={[
            { label: 'ID', value: detail.id, mono: true },
            { label: 'Name', value: detail.name || '—' },
            { label: 'CIDR', value: detail.cidr || '—', mono: true },
            { label: 'Region', value: detail.region || '—' },
            { label: 'State', value: detail.state || 'Unknown' },
          ]}
          raw={detail}
        />
      )}
      <Table<Vpc>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.id}
        onPrimaryAction={setDetail}
        onRowContextMenu={onRowContextMenu}
        storageKey="vpcs"
        columns={[
          {
            key: 'id',
            header: 'ID',
            width: 200,
            sortAccessor: (r) => r.id,
            render: (r) => <span className="font-mono text-[12px]">{r.id}</span>,
          },
          {
            key: 'name',
            header: 'Name',
            width: 220,
            sortAccessor: (r) => r.name ?? '',
            render: (r) => <span className="text-zViolet-accent">{r.name || '-'}</span>,
          },
          {
            key: 'cidr',
            header: 'CIDR',
            width: 160,
            sortAccessor: (r) => r.cidr ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.cidr || '-'}</span>
            ),
          },
          {
            key: 'region',
            header: 'Region',
            width: 130,
            sortAccessor: (r) => r.region ?? '',
            render: (r) => <span className="text-secondary">{r.region || '-'}</span>,
          },
          {
            key: 'state',
            header: 'State',
            width: 110,
            sortAccessor: (r) => r.state ?? '',
            render: (r) => <StatusBadge status={r.state || 'Unknown'} />,
          },
        ]}
      />
    </>
  )
}

export function NaclsView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<Nacl>
  getRowLink?: (nacl: Nacl) => string
}) {
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = applyFilter(items, filter, (n) => `${n.id} ${n.vpcId} ${n.region}`)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)
  const [detail, setDetail] = useState<Nacl | null>(null)

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {menu}
      {detail && (
        <LeafDetailPanel
          open
          onClose={() => setDetail(null)}
          title={detail.id}
          subtitle="Network ACL"
          fields={[
            { label: 'ID', value: detail.id, mono: true },
            { label: 'VPC', value: detail.vpcId, mono: true },
            { label: 'Region', value: detail.region },
            { label: 'Default', value: detail.isDefault ? 'Yes' : 'No' },
            {
              label: 'Subnet Assoc',
              value: detail.associations?.length ?? 0,
            },
            { label: 'Entries', value: detail.entries?.length ?? 0 },
          ]}
          raw={detail}
        />
      )}
      <Table<Nacl>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.id}
        onPrimaryAction={setDetail}
        onRowContextMenu={onRowContextMenu}
        storageKey="nacls"
        columns={[
          {
            key: 'id',
            header: 'ID',
            width: 200,
            sortAccessor: (r) => r.id,
            render: (r) => (
              <span className="font-mono text-[12px] text-zViolet-accent">{r.id}</span>
            ),
          },
          {
            key: 'vpcId',
            header: 'VPC',
            width: 200,
            sortAccessor: (r) => r.vpcId,
            render: (r) => <span className="font-mono text-[12px] text-secondary">{r.vpcId}</span>,
          },
          {
            key: 'region',
            header: 'Region',
            width: 130,
            sortAccessor: (r) => r.region,
            render: (r) => <span className="text-secondary">{r.region}</span>,
          },
          {
            key: 'default',
            header: 'Default',
            width: 90,
            sortAccessor: (r) => (r.isDefault ? 1 : 0),
            render: (r) => (r.isDefault ? <span className="text-success">Yes</span> : '—'),
          },
          {
            key: 'assoc',
            header: 'Subnet Assoc',
            width: 130,
            sortAccessor: (r) => r.associations?.length ?? 0,
            render: (r) =>
              r.associations && r.associations.length > 0 ? (
                r.associations.length
              ) : (
                <span className="text-tertiary">-</span>
              ),
          },
          {
            key: 'entries',
            header: 'Entries',
            width: 90,
            sortAccessor: (r) => r.entries?.length ?? 0,
            render: (r) => (r.entries ? r.entries.length : 0),
          },
        ]}
      />
    </>
  )
}
