import { RotateCcw, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { LeafDetailPanel } from '../../components/LeafDetailPanel'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { t } from '../../i18n'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { formatLightsailPorts } from './lightsail-format'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { AwsLightsailInstance } from '../../types'

export function LightsailInstancesView({
  loader,
  onOpenSsh,
  onReboot,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<AwsLightsailInstance>
  onOpenSsh: (instance: AwsLightsailInstance) => void
  onReboot: (instance: AwsLightsailInstance) => Promise<void>
  getRowLink?: (instance: AwsLightsailInstance) => string
}) {
  const [menu, setMenu] = useState<{ instance: AwsLightsailInstance; x: number; y: number } | null>(
    null,
  )
  const { pollTick } = useWorkspaceTab()
  const { items, setItems, loading, error, setError } = useResourceList(
    loader,
    refreshKey,
    onLoading,
    { pollTick },
  )

  const [reloading, setReloading] = useState(false)

  async function reload() {
    setError(null)
    setReloading(true)
    try {
      const res = await loader()

      setItems(res)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setReloading(false)
    }
  }

  const linkActions = useRowLinkActions(getRowLink)
  const [detail, setDetail] = useState<AwsLightsailInstance | null>(null)

  function buildInstanceMenu(instance: AwsLightsailInstance): ContextMenuItem[] {
    const canSsh = !!instance.username && !!instance.publicIp
    const running = (instance.state || '').toLowerCase() === 'running'
    const linkItems = linkActions(instance)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'ssh',
        label: 'SSH',
        icon: Terminal,
        disabled: !canSsh,
        hint: canSsh ? undefined : t('no ip'),
        onSelect: () => {
          onOpenSsh(instance)
        },
      },
      {
        key: 'reboot',
        label: t('Restart'),
        icon: RotateCcw,
        disabled: !running,
        hint: running ? undefined : instance.state || 'stopped',
        confirm: t('Restart Lightsail instance "{name}"?', { name: instance.name }),
        onSelect: async () => {
          try {
            await onReboot(instance)
            await reload()
          } catch (e) {
            setError(String(e instanceof Error ? e.message : e))
          }
        },
      },
    ]
  }

  const filtered = applyFilter(
    items,
    filter,
    (i) =>
      `${i.name} ${i.region} ${i.blueprintName ?? ''} ${i.bundleId ?? ''} ${i.publicIp ?? ''} ${i.privateIp ?? ''}`,
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
      {detail && (
        <LeafDetailPanel
          open
          onClose={() => setDetail(null)}
          title={detail.name}
          subtitle={t('Lightsail instance')}
          fields={[
            { label: t('Name'), value: detail.name },
            { label: t('Region'), value: detail.region },
            { label: t('State'), value: detail.state || t('Unknown') },
            { label: t('Blueprint'), value: detail.blueprintName ?? '—' },
            { label: t('Bundle'), value: detail.bundleId ?? '—', mono: true },
            { label: t('Public IP'), value: detail.publicIp ?? '—', mono: true },
            { label: t('Private IP'), value: detail.privateIp ?? '—', mono: true },
            { label: t('Static IP'), value: detail.isStaticIp ? t('Yes') : t('No') },
            { label: 'vCPU', value: detail.cpuCount ?? '—' },
            { label: t('RAM (GB)'), value: detail.ramSizeInGb ?? '—' },
            { label: t('Username'), value: detail.username ?? '—', mono: true },
            { label: t('Created'), value: detail.createdAt ?? '—' },
            {
              label: t('Ports'),
              full: true,
              mono: true,
              value: formatLightsailPorts(detail.ports) || '—',
            },
          ]}
          raw={detail}
        />
      )}
      <Table<AwsLightsailInstance>
        loading={loading || reloading}
        rows={filtered}
        rowKey={(r) => r.arn ?? `${r.region}/${r.name}`}
        onPrimaryAction={setDetail}
        onRowContextMenu={(instance, e) => setMenu({ instance, x: e.clientX, y: e.clientY })}
        storageKey="aws.lightsail-instances"
        columns={[
          {
            key: 'name',
            header: t('Name'),
            width: 220,
            sortAccessor: (r) => r.name,
            render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
          },
          {
            key: 'state',
            header: t('State'),
            width: 110,
            sortAccessor: (r) => r.state,
            render: (r) => <StatusBadge status={r.state || 'Unknown'} />,
          },
          {
            key: 'region',
            header: t('Region'),
            width: 130,
            sortAccessor: (r) => r.region,
            render: (r) => <span className="text-secondary">{r.region}</span>,
          },
          {
            key: 'bundle',
            header: t('Bundle'),
            width: 130,
            sortAccessor: (r) => r.bundleId ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.bundleId ?? '-'}</span>
            ),
          },
          {
            key: 'blueprint',
            header: t('Blueprint'),
            width: 190,
            sortAccessor: (r) => r.blueprintName ?? r.blueprintId ?? '',
            render: (r) => (
              <span
                className="text-secondary truncate block max-w-[170px]"
                title={r.blueprintName ?? r.blueprintId ?? undefined}
              >
                {r.blueprintName ?? r.blueprintId ?? '-'}
              </span>
            ),
          },
          {
            key: 'publicIp',
            header: t('Public IP'),
            width: 140,
            sortAccessor: (r) => r.publicIp ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.publicIp ?? '-'}</span>
            ),
          },
          {
            key: 'staticIp',
            header: t('Static IP'),
            width: 90,
            sortAccessor: (r) => (r.isStaticIp ? 1 : 0),
            render: (r) => (r.isStaticIp ? <span className="text-success">{t('Yes')}</span> : '-'),
          },
          {
            key: 'size',
            header: t('Size'),
            width: 110,
            sortAccessor: (r) => (r.cpuCount ?? 0) * 10000 + (r.ramSizeInGb ?? 0),
            render: (r) => (
              <span className="text-secondary">
                {t('{cpu} vCPU / {ram} GB', { cpu: r.cpuCount ?? '-', ram: r.ramSizeInGb ?? '-' })}
              </span>
            ),
          },
          {
            key: 'ports',
            header: t('Ports'),
            width: 180,
            sortAccessor: (r) => formatLightsailPorts(r.ports),
            render: (r) => (
              <span
                className="font-mono text-[12px] text-secondary truncate block max-w-[160px]"
                title={formatLightsailPorts(r.ports) || undefined}
              >
                {formatLightsailPorts(r.ports) || '-'}
              </span>
            ),
          },
          {
            key: 'age',
            header: t('Age'),
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
