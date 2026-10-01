import { useEffect, useMemo, useState } from 'react'

import { Age } from '../../components/Age'
import { LeafDetailPanel } from '../../components/LeafDetailPanel'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { AliyunEcsInstance } from '../../types'

// Aliyun ECS servers — read-only list + click-through detail panel, mirroring
// TencentCvmInstancesView / EC2InstancesView (browse-only, no SSH/actions).
export function AliyunEcsInstancesView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  loader: ResourceListLoader<AliyunEcsInstance>
}) {
  const [detail, setDetail] = useState<AliyunEcsInstance | null>(null)
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(
    loader,
    refreshKey,
    onLoading,
    // Pause polling while the detail modal is open (see AliyunSwasInstancesView).
    { pollTick: detail ? undefined : pollTick },
  )

  const filtered = useMemo(
    () =>
      applyFilter(
        items,
        filter,
        (i) =>
          `${i.instanceId} ${i.name} ${i.publicIp ?? ''} ${i.privateIp ?? ''} ${i.instanceType} ${i.region} ${i.state}`,
      ),
    [items, filter],
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  function specLabel(i: AliyunEcsInstance): string {
    if (i.cpu == null && i.memoryGb == null) return '—'
    const cpu = i.cpu != null ? `${String(i.cpu)} vCPU` : ''
    const mem = i.memoryGb != null ? `${String(i.memoryGb)} GB` : ''

    return [cpu, mem].filter(Boolean).join(' · ')
  }

  return (
    <>
      {detail && (
        <LeafDetailPanel
          open
          onClose={() => setDetail(null)}
          title={detail.name || detail.instanceId}
          subtitle="ECS instance"
          fields={[
            { label: 'Instance ID', value: detail.instanceId, mono: true },
            { label: 'Type', value: detail.instanceType, mono: true },
            { label: 'State', value: detail.state },
            { label: 'Region', value: detail.region },
            { label: 'Zone', value: detail.zone || '—' },
            { label: 'Public IP', value: detail.publicIp ?? '—', mono: true },
            { label: 'Private IP', value: detail.privateIp ?? '—', mono: true },
            { label: 'Spec', value: specLabel(detail) },
            { label: 'OS', value: detail.osName ?? '—' },
            { label: 'Image', value: detail.imageId ?? '—', mono: true },
            { label: 'Created', value: detail.createdAt ?? '—' },
          ]}
          raw={detail}
        />
      )}
      <Table<AliyunEcsInstance>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.instanceId}
        onPrimaryAction={setDetail}
        storageKey="aliyun.ecs-instances"
        columns={[
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
            key: 'instanceType',
            header: 'Type',
            width: 150,
            sortAccessor: (r) => r.instanceType,
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.instanceType}</span>
            ),
          },
          {
            key: 'state',
            header: 'State',
            width: 110,
            sortAccessor: (r) => r.state,
            render: (r) => {
              const s = r.state
              let cls = 'text-secondary'

              if (s === 'Running') cls = 'text-[#73bf69]'
              else if (s === 'Stopped') cls = 'text-error'
              else if (/Pending|Starting|Stopping/.test(s)) cls = 'text-amber-400'

              return <span className={cls}>{s}</span>
            },
          },
          {
            key: 'zone',
            header: 'Zone',
            width: 150,
            sortAccessor: (r) => r.zone,
            render: (r) => <span className="text-secondary">{r.zone || '—'}</span>,
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
            key: 'privateIp',
            header: 'Private IP',
            width: 140,
            sortAccessor: (r) => r.privateIp ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.privateIp ?? '—'}</span>
            ),
          },
          {
            key: 'spec',
            header: 'Spec',
            width: 140,
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
        ]}
      />
    </>
  )
}
