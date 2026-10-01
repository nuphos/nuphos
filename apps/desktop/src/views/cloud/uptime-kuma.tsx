import { Folder } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useResetOnKey } from '../useResetOnKey'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'
import { buildUptimeKumaMonitorRows } from './uptime-kuma-monitors'

import type { CommonProps } from './shared'
import type { UptimeKumaMonitorRow } from './uptime-kuma-monitors'
import type { UptimeKumaInstance, UptimeKumaMonitor } from '../../types'

export function UptimeKumaInstanceView({
  teamId,
  instance,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  teamId: string
  instance: UptimeKumaInstance | undefined
}) {
  const [monitors, setMonitors] = useState<UptimeKumaMonitor[]>([])
  const [error, setError] = useState<string | null>(null)
  // The mount fetch is already in flight, so seed `loading` the way the reset
  // below would have; it only runs for later instance/refresh changes.
  const [loading, setLoading] = useState(!!instance)

  useResetOnKey(`${teamId}|${instance?.id ?? ''}|${String(refreshKey)}`, () => {
    setMonitors([])
    setError(null)
    setLoading(!!instance)
  })
  useEffect(() => {
    if (!instance) {
      onLoading?.(false)

      return
    }
    let cancelled = false

    onLoading?.(true)
    api
      .atlasListUptimeKumaMonitors(teamId, instance.id)
      .then((next) => {
        if (!cancelled) setMonitors(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(parseAtlasError(err).message)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          onLoading?.(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [instance, onLoading, refreshKey, teamId])

  const rows = useMemo(() => buildUptimeKumaMonitorRows(monitors), [monitors])
  const filtered = applyFilter(rows, filter, (row) => row.searchText)

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (!instance) {
    return <ErrorBlock message="Uptime Kuma instance not found." />
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {error && (
        <div className="px-6 py-2 border-b border-error/30 bg-error/10 text-[12.5px] text-error">
          {error}
        </div>
      )}
      <Table<UptimeKumaMonitorRow>
        loading={loading}
        rows={filtered}
        rowKey={(row) => row.key}
        empty={
          loading
            ? 'Loading Uptime Kuma monitors...'
            : filter
              ? 'No Uptime Kuma monitors match the current filter.'
              : 'No Uptime Kuma monitors found.'
        }
        storageKey="uptime-kuma.monitors.hierarchy"
        columns={[
          {
            key: 'id',
            header: 'ID',
            width: 96,
            render: (row) => <span className="font-mono text-[12px] text-secondary">{row.id}</span>,
          },
          {
            key: 'name',
            header: 'Name',
            width: 320,
            render: (row) => (
              <div
                className="flex items-center gap-2 min-w-0"
                style={{ paddingLeft: row.depth * 18 }}
              >
                {row.isGroup ? (
                  <Folder className="w-3.5 h-3.5 flex-shrink-0 text-tertiary" strokeWidth={1.8} />
                ) : row.depth > 0 ? (
                  <span className="w-3.5 h-3.5 flex-shrink-0 border-l border-b border-zGray-700/70 rounded-bl-[3px]" />
                ) : (
                  <span className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                <span
                  className={`text-main truncate ${row.isGroup ? 'font-semibold' : 'font-medium'}`}
                >
                  {row.name}
                </span>
              </div>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            width: 140,
            render: (row) => <span className="text-secondary">{row.type}</span>,
          },
          {
            key: 'target',
            header: 'Target',
            width: 420,
            render: (row) => (
              <span className="font-mono text-[12px] text-secondary truncate">
                {row.target || '-'}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            width: 140,
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: 'interval',
            header: 'Interval',
            width: 150,
            render: (row) => (
              <span className="text-secondary">
                {row.interval != null ? `${String(row.interval)}s` : '-'}
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}
