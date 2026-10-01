import { useEffect, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useResetOnKey } from '../useResetOnKey'

import { buildBetterStackRows } from './betterstack-rows'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { BetterStackPage, BetterStackRow } from './betterstack-rows'
import type { CommonProps } from './shared'
import type {
  BetterStackCollector,
  BetterStackDashboard,
  BetterStackHeartbeat,
  BetterStackIncident,
  BetterStackIntegration,
  BetterStackMonitor,
  BetterStackSource,
} from '../../types'

export type { BetterStackPage } from './betterstack-rows'

export function BetterStackIntegrationView({
  teamId,
  integration,
  page,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  teamId: string
  integration: BetterStackIntegration | undefined
  page: BetterStackPage
}) {
  const [monitors, setMonitors] = useState<BetterStackMonitor[]>([])
  const [heartbeats, setHeartbeats] = useState<BetterStackHeartbeat[]>([])
  const [incidents, setIncidents] = useState<BetterStackIncident[]>([])
  const [sources, setSources] = useState<BetterStackSource[]>([])
  const [collectors, setCollectors] = useState<BetterStackCollector[]>([])
  const [dashboards, setDashboards] = useState<BetterStackDashboard[]>([])
  const [error, setError] = useState<string | null>(null)
  // The mount fetch is already in flight, so seed `loading` the way the reset
  // below would have; it only runs for later integration/page/refresh changes.
  const [loading, setLoading] = useState(!!integration)

  useResetOnKey(`${teamId}|${integration?.id ?? ''}|${page}|${String(refreshKey)}`, () => {
    setMonitors([])
    setHeartbeats([])
    setIncidents([])
    setSources([])
    setCollectors([])
    setDashboards([])
    setError(null)
    setLoading(!!integration)
  })
  useEffect(() => {
    if (!integration) {
      onLoading?.(false)

      return
    }
    let cancelled = false

    onLoading?.(true)
    const load = async () => {
      if (page === 'monitors') {
        const [nextMonitors, nextHeartbeats] = await Promise.all([
          integration.hasUptimeApiToken
            ? api.atlasListBetterStackMonitors(teamId, integration.id)
            : Promise.resolve([] as BetterStackMonitor[]),
          integration.hasUptimeApiToken
            ? api.atlasListBetterStackHeartbeats(teamId, integration.id)
            : Promise.resolve([] as BetterStackHeartbeat[]),
        ])

        if (cancelled) return
        setMonitors(nextMonitors)
        setHeartbeats(nextHeartbeats)
      } else if (page === 'incidents') {
        const next = integration.hasUptimeApiToken
          ? await api.atlasListBetterStackIncidents(teamId, integration.id)
          : []

        if (!cancelled) setIncidents(next)
      } else if (page === 'dashboards') {
        const next = integration.hasTelemetryApiToken
          ? await api.atlasListBetterStackDashboards(teamId, integration.id)
          : []

        if (!cancelled) setDashboards(next)
      } else {
        const [nextSources, nextCollectors] = await Promise.all([
          integration.hasTelemetryApiToken
            ? api.atlasListBetterStackSources(teamId, integration.id)
            : Promise.resolve([] as BetterStackSource[]),
          integration.hasTelemetryApiToken
            ? api.atlasListBetterStackCollectors(teamId, integration.id)
            : Promise.resolve([] as BetterStackCollector[]),
        ])

        if (cancelled) return
        setSources(nextSources)
        setCollectors(nextCollectors)
      }
    }

    load()
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
  }, [integration, onLoading, refreshKey, teamId, page])

  const rows = buildBetterStackRows(page, {
    monitors,
    heartbeats,
    incidents,
    dashboards,
    sources,
    collectors,
  })
  const filtered = applyFilter(
    rows,
    filter,
    (row) => `${row.kind} ${row.name} ${row.detail} ${row.status ?? ''}`,
  )

  const requiredToken: 'uptime' | 'telemetry' =
    page === 'sources' || page === 'dashboards' ? 'telemetry' : 'uptime'
  const hasRequiredToken =
    requiredToken === 'telemetry'
      ? integration?.hasTelemetryApiToken
      : integration?.hasUptimeApiToken
  const showKindColumn = page === 'sources' || page === 'monitors'

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (!integration) {
    return <ErrorBlock message="Better Stack integration not found." />
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {error && (
        <div className="px-6 py-2 border-b border-error/30 bg-error/10 text-[12.5px] text-error">
          {error}
        </div>
      )}
      <Table<BetterStackRow>
        loading={loading}
        rows={filtered}
        rowKey={(row) => row.key}
        empty={
          loading
            ? `Loading Better Stack ${page}...`
            : !hasRequiredToken
              ? `Add ${requiredToken === 'telemetry' ? 'a Telemetry' : 'an Uptime'} API token to view ${page}.`
              : filter
                ? `No Better Stack ${page} match the current filter.`
                : `No Better Stack ${page} found.`
        }
        storageKey={`betterstack.${page}`}
        columns={[
          ...(showKindColumn
            ? [
                {
                  key: 'kind',
                  header: 'Kind',
                  width: 140,
                  sortAccessor: (row: BetterStackRow) => row.kind,
                  render: (row: BetterStackRow) => (
                    <span className="text-secondary">{row.kind}</span>
                  ),
                },
              ]
            : []),
          {
            key: 'name',
            header: 'Name',
            width: 300,
            sortAccessor: (row) => row.name,
            render: (row) => <span className="text-main font-medium truncate">{row.name}</span>,
          },
          ...(page === 'dashboards'
            ? []
            : [
                {
                  key: 'detail',
                  header: page === 'incidents' ? 'Cause' : 'Detail',
                  width: 360,
                  sortAccessor: (row: BetterStackRow) => row.detail,
                  render: (row: BetterStackRow) => (
                    <span className="font-mono text-[12px] text-secondary truncate">
                      {row.detail || '-'}
                    </span>
                  ),
                },
              ]),
          ...(page === 'dashboards'
            ? []
            : [
                {
                  key: 'status',
                  header: 'Status',
                  width: 140,
                  sortAccessor: (row: BetterStackRow) => row.status ?? '',
                  render: (row: BetterStackRow) => <StatusBadge status={row.status ?? 'unknown'} />,
                },
              ]),
          {
            key: 'updated',
            header: page === 'incidents' ? 'Last event' : 'Updated',
            width: 180,
            sortAccessor: (row) => row.updatedAt || '',
            render: (row) =>
              row.updatedAt ? (
                <Age value={row.updatedAt} />
              ) : (
                <span className="text-tertiary">-</span>
              ),
          },
        ]}
      />
    </div>
  )
}
