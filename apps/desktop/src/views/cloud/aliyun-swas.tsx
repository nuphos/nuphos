import { useCallback, useEffect, useMemo, useState } from 'react'

import { Age } from '../../components/Age'
import { LeafDetailPanel } from '../../components/LeafDetailPanel'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { Column } from '../../components/Table'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { AliyunSwasInstance } from '../../types'

// Aliyun Simple Application Server (SWAS) — read-only list + detail panel,
// mirroring AliyunEcsInstancesView (browse-only, the Lightsail analogue).
export function AliyunSwasInstancesView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  loader: ResourceListLoader<AliyunSwasInstance>
}) {
  const [detail, setDetail] = useState<AliyunSwasInstance | null>(null)
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(
    loader,
    refreshKey,
    onLoading,
    // Pause background polling while a row's detail modal is open. Otherwise the
    // periodic refetch does setItems() with 1000+ fresh objects, re-sorting and
    // re-rendering the table (and recompositing the blurred overlay) under the
    // modal — a hitch that intermittently drops hover/click on the modal itself.
    { pollTick: detail ? undefined : pollTick },
  )

  // Memoized so opening/closing the detail panel (a `detail` state change) does
  // NOT rebuild these arrays. With ~1300 rows, an unstable `rows`/`columns`
  // reference forces the virtualized Table to re-sort + re-key every row on each
  // render, which is what made closing the modal jank.
  const filtered = useMemo(
    () =>
      applyFilter(
        items,
        filter,
        (i) =>
          `${i.instanceId} ${i.name} ${i.publicIp ?? ''} ${i.privateIp ?? ''} ${i.plan} ${i.region} ${i.status}`,
      ),
    [items, filter],
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const specLabel = useCallback((i: AliyunSwasInstance): string => {
    const parts = [
      i.cpu != null ? `${String(i.cpu)} vCPU` : '',
      i.memoryGb != null ? `${String(i.memoryGb)} GB` : '',
      i.diskGb != null ? `${String(i.diskGb)} GB disk` : '',
    ].filter(Boolean)

    return parts.length ? parts.join(' · ') : '—'
  }, [])

  const rowKey = useCallback((r: AliyunSwasInstance) => r.instanceId, [])

  const columns = useMemo<Column<AliyunSwasInstance>[]>(
    () => [
      {
        key: 'instanceId',
        header: 'Instance ID',
        width: 190,
        sortAccessor: (r) => r.instanceId,
        render: (r) => <span className="font-mono text-[12px]">{r.instanceId}</span>,
      },
      {
        key: 'name',
        header: 'Name',
        width: 180,
        sortAccessor: (r) => r.name,
        render: (r) => <span className="text-secondary">{r.name}</span>,
      },
      {
        key: 'plan',
        header: 'Plan',
        width: 140,
        sortAccessor: (r) => r.plan,
        render: (r) => (
          <span className="font-mono text-[12px] text-secondary">{r.plan || '—'}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: 110,
        sortAccessor: (r) => r.status,
        render: (r) => {
          const s = r.status
          let cls = 'text-secondary'

          if (s === 'Running') cls = 'text-[#73bf69]'
          else if (s === 'Stopped') cls = 'text-error'
          else if (/Pending|Starting|Stopping|Resetting|Upgrading/.test(s)) cls = 'text-amber-400'

          return <span className={cls}>{s}</span>
        },
      },
      {
        key: 'region',
        header: 'Region',
        width: 140,
        sortAccessor: (r) => r.region,
        render: (r) => <span className="text-secondary">{r.region}</span>,
      },
      {
        key: 'publicIp',
        header: 'Public IP',
        width: 140,
        sortAccessor: (r) => r.publicIp ?? '',
        render: (r) => (
          <span className="font-mono text-[12px] text-secondary">{r.publicIp ?? '—'}</span>
        ),
      },
      {
        key: 'spec',
        header: 'Spec',
        width: 180,
        sortAccessor: (r) => r.cpu ?? 0,
        render: (r) => <span className="text-secondary">{specLabel(r)}</span>,
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
    ],
    [specLabel],
  )

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {detail && (
        <LeafDetailPanel
          open
          onClose={() => setDetail(null)}
          title={detail.name || detail.instanceId}
          subtitle="Simple Application Server"
          fields={[
            { label: 'Instance ID', value: detail.instanceId, mono: true },
            { label: 'Plan', value: detail.plan || '—', mono: true },
            { label: 'Status', value: detail.status },
            { label: 'Subscription', value: detail.businessStatus ?? '—' },
            { label: 'Region', value: detail.region },
            { label: 'Public IP', value: detail.publicIp ?? '—', mono: true },
            { label: 'Private IP', value: detail.privateIp ?? '—', mono: true },
            { label: 'Spec', value: specLabel(detail) },
            { label: 'OS', value: detail.osName ?? '—' },
            { label: 'Image', value: detail.imageId ?? '—', mono: true },
            { label: 'Created', value: detail.createdAt ?? '—' },
            { label: 'Expires', value: detail.expiredAt ?? '—' },
          ]}
          raw={detail}
        />
      )}
      <Table<AliyunSwasInstance>
        loading={loading}
        rows={filtered}
        rowKey={rowKey}
        onPrimaryAction={setDetail}
        storageKey="aliyun.swas-instances"
        columns={columns}
      />
    </>
  )
}
