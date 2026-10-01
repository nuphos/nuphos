import { Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { LeafDetailPanel } from '../../components/LeafDetailPanel'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { AwsEc2Instance } from '../../types'

export function EC2InstancesView({
  loader,
  onOpenSsh,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<AwsEc2Instance>
  onOpenSsh?: (instance: AwsEc2Instance) => void
  getRowLink?: (instance: AwsEc2Instance) => string
}) {
  const [menu, setMenu] = useState<{ instance: AwsEc2Instance; x: number; y: number } | null>(null)
  const [detail, setDetail] = useState<AwsEc2Instance | null>(null)
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const linkActions = useRowLinkActions(getRowLink)

  function buildInstanceMenu(instance: AwsEc2Instance): ContextMenuItem[] {
    const linux = (instance.platform ?? 'linux').toLowerCase() !== 'windows'
    const canSsh = !!onOpenSsh && instance.state === 'running' && !!instance.publicIp && linux
    const hint = !linux
      ? 'windows'
      : instance.state !== 'running'
        ? instance.state
        : !instance.publicIp
          ? 'no public IP'
          : undefined
    const linkItems = linkActions(instance)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'ssh',
        label: 'SSH',
        icon: Terminal,
        disabled: !canSsh,
        hint,
        onSelect: () => {
          if (onOpenSsh) onOpenSsh(instance)
        },
      },
    ]
  }

  const filtered = applyFilter(items, filter, (i) => `${i.instanceId} ${i.tags.Name ?? ''}`)

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
      {detail && (
        <LeafDetailPanel
          open
          onClose={() => setDetail(null)}
          title={detail.tags.Name || detail.instanceId}
          subtitle="EC2 instance"
          fields={[
            { label: 'Instance ID', value: detail.instanceId, mono: true },
            { label: 'Type', value: detail.instanceType, mono: true },
            { label: 'State', value: detail.state },
            { label: 'Public IP', value: detail.publicIp ?? '—', mono: true },
            { label: 'Private IP', value: detail.privateIp ?? '—', mono: true },
            {
              label: 'Platform',
              value: detail.platform === 'windows' ? 'Windows' : 'Linux',
            },
            { label: 'Launched', value: detail.launchTime ?? '—' },
          ]}
          raw={detail}
        />
      )}
      <Table<AwsEc2Instance>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.instanceId}
        onPrimaryAction={setDetail}
        onRowContextMenu={(instance, e) => setMenu({ instance, x: e.clientX, y: e.clientY })}
        storageKey="aws.ec2-instances"
        columns={[
          {
            key: 'instanceId',
            header: 'Instance ID',
            width: 200,
            sortAccessor: (r) => r.instanceId,
            render: (r) => <span className="font-mono text-[12px]">{r.instanceId}</span>,
          },
          {
            key: 'instanceType',
            header: 'Type',
            width: 130,
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

              if (s === 'running') cls = 'text-[#73bf69]'
              else if (s === 'stopped') cls = 'text-error'
              else if (s === 'pending' || s === 'stopping') cls = 'text-amber-400'

              return <span className={cls}>{s}</span>
            },
          },
          {
            key: 'az',
            header: 'AZ',
            width: 150,
            sortAccessor: (r) => r.availabilityZone,
            render: (r) => <span className="text-secondary">{r.availabilityZone}</span>,
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
            key: 'platform',
            header: 'Platform',
            width: 100,
            sortAccessor: (r) => r.platform ?? '',
            render: (r) => (
              <span className="text-secondary">
                {r.platform === 'windows' ? 'Windows' : 'Linux'}
              </span>
            ),
          },
          {
            key: 'age',
            header: 'Age',
            width: 100,
            sortAccessor: (r) => r.launchTime ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.launchTime} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
