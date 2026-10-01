import { useEffect, useState } from 'react'

import { api } from '../api'
import { Age } from '../components/Age'
import { ContextMenu } from '../components/ContextMenu'
import { LeafDetailPanel } from '../components/LeafDetailPanel'
import { StatusBadge } from '../components/StatusBadge'
import { Table } from '../components/Table'
import { useReportLoading } from '../components/useReportLoading'
import { useReportVisibleError } from '../components/VisibleErrorReporter'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { reportFrontendError } from '../lib/frontendErrorReporter'

import { useResetOnKey } from './useResetOnKey'

import type { ContextMenuItem } from '../components/ContextMenu'
import type { TailscaleDevice } from '../types'

type Props = {
  teamId: string
  clientId: string
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
  useReportVisibleError(message, 'tailscale_error_block')

  return <div className="p-8 text-error text-[13px]">{message}</div>
}

export function TailscaleDevicesView({
  teamId,
  clientId,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: Props) {
  const [items, setItems] = useState<TailscaleDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<TailscaleDevice | null>(null)
  const [menuState, setMenuState] = useState<{
    device: TailscaleDevice
    x: number
    y: number
  } | null>(null)
  const { pollTick } = useWorkspaceTab()

  useReportLoading(loading, onLoading)

  useResetOnKey(`${teamId}|${clientId}|${String(refreshKey)}|${String(pollTick)}`, () => {
    setLoading(true)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    api
      .atlasListTailscaleDevices(teamId, clientId)
      .then((res) => {
        if (cancelled) return
        setItems(res)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, clientId, refreshKey, pollTick])

  const filtered = applyFilter(
    items,
    filter,
    (i) =>
      `${i.name} ${i.hostname ?? ''} ${i.os ?? ''} ${i.user ?? ''} ${i.addresses.join(' ')} ${i.tags.join(' ')}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  const menuItems = (device: TailscaleDevice): ContextMenuItem[] => [
    {
      key: 'copy-name',
      label: 'Copy name',
      onSelect: () =>
        navigator.clipboard.writeText(device.name).catch((cause: unknown) => {
          reportFrontendError(
            { source: 'clipboard', phase: 'tailscale_device_name', message: 'Copy failed.' },
            cause,
          )
        }),
    },
    ...(device.addresses[0]
      ? [
          {
            key: 'copy-ip',
            label: 'Copy IP address',
            onSelect: () =>
              navigator.clipboard.writeText(device.addresses[0]!).catch((cause: unknown) => {
                reportFrontendError(
                  {
                    source: 'clipboard',
                    phase: 'tailscale_device_address',
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
            key: 'name',
            header: 'Name',
            render: (i) => <span className="font-mono text-[12px]">{i.name}</span>,
            sortAccessor: (i) => i.name,
          },
          {
            key: 'os',
            header: 'OS',
            render: (i) => <span className="text-secondary">{i.os ?? '-'}</span>,
            sortAccessor: (i) => i.os ?? '',
          },
          {
            key: 'user',
            header: 'User',
            render: (i) => <span className="text-secondary text-[11.5px]">{i.user ?? '-'}</span>,
            sortAccessor: (i) => i.user ?? '',
          },
          {
            key: 'status',
            header: 'Status',
            render: (i) => (
              <StatusBadge
                status={
                  i.online === true ? 'connected' : i.online === false ? 'offline' : 'unknown'
                }
              />
            ),
            sortAccessor: (i) => String(i.online ?? ''),
          },
          {
            key: 'ip',
            header: 'IP',
            render: (i) => (
              <span className="font-mono text-[11.5px] text-secondary">
                {i.addresses[0] ?? '-'}
              </span>
            ),
            sortAccessor: (i) => i.addresses[0] ?? '',
          },
          {
            key: 'lastSeen',
            header: 'Last Seen',
            render: (i) =>
              i.lastSeen ? <Age value={i.lastSeen} /> : <span className="text-tertiary">-</span>,
            sortAccessor: (i) => i.lastSeen ?? '',
          },
          {
            key: 'tags',
            header: 'Tags',
            render: (i) =>
              i.tags.length === 0 ? (
                <span className="text-tertiary">-</span>
              ) : (
                <span
                  className="flex items-center gap-1 overflow-hidden whitespace-nowrap"
                  title={i.tags.join(' ')}
                >
                  {i.tags.map((t) => (
                    <span
                      key={t}
                      className="bg-zGray-800 px-1.5 py-0.5 rounded text-[11px] text-tertiary font-mono"
                    >
                      {t}
                    </span>
                  ))}
                </span>
              ),
            sortAccessor: (i) => i.tags.join(' '),
          },
        ]}
        rows={filtered}
        rowKey={(i) => i.id || i.name}
        storageKey="tailscale.devices"
        defaultSort={{ key: 'name', dir: 'asc' }}
        onPrimaryAction={setSelected}
        onRowContextMenu={(device, e) => setMenuState({ device, x: e.clientX, y: e.clientY })}
      />
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={menuItems(menuState.device)}
          onClose={() => setMenuState(null)}
        />
      )}
      {selected && (
        <LeafDetailPanel
          open
          onClose={() => setSelected(null)}
          title={selected.name}
          fields={[
            { label: 'ID', value: selected.id, mono: true },
            { label: 'Hostname', value: selected.hostname ?? '-' },
            { label: 'OS', value: selected.os ?? '-' },
            { label: 'User', value: selected.user ?? '-' },
            {
              label: 'Status',
              value: selected.online == null ? '-' : selected.online ? 'Connected' : 'Offline',
            },
            {
              label: 'Authorized',
              value: selected.authorized == null ? '-' : selected.authorized ? 'Yes' : 'No',
            },
            { label: 'Addresses', value: selected.addresses.join(', ') || '-', mono: true },
            { label: 'Tags', value: selected.tags.join(', ') || '-' },
            { label: 'Created', value: selected.createdAt ?? '-' },
            { label: 'Last Seen', value: selected.lastSeen ?? '-' },
            { label: 'Expires', value: selected.expiresAt ?? '-' },
          ]}
        />
      )}
    </>
  )
}
