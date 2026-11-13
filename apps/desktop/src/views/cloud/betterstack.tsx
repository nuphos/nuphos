import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api, parseAtlasError } from '../../api'
import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { useRefreshKey } from '../../lib/query/tabQuery'

import { buildBetterStackRows } from './betterstack-rows'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { BetterStackPage, BetterStackRow } from './betterstack-rows'
import type { CommonProps } from './shared'
import type { BetterStackIntegration } from '../../types'

export type { BetterStackPage } from './betterstack-rows'

const EMPTY_TEXT: Record<BetterStackPage, [string, string, string, string]> = {
  monitors: [
    t('Loading Better Stack monitors...'),
    t('Add an Uptime API token to view monitors.'),
    t('No Better Stack monitors match the current filter.'),
    t('No Better Stack monitors found.'),
  ],
  incidents: [
    t('Loading Better Stack incidents...'),
    t('Add an Uptime API token to view incidents.'),
    t('No Better Stack incidents match the current filter.'),
    t('No Better Stack incidents found.'),
  ],
  sources: [
    t('Loading Better Stack sources...'),
    t('Add a Telemetry API token to view sources.'),
    t('No Better Stack sources match the current filter.'),
    t('No Better Stack sources found.'),
  ],
  dashboards: [
    t('Loading Better Stack dashboards...'),
    t('Add a Telemetry API token to view dashboards.'),
    t('No Better Stack dashboards match the current filter.'),
    t('No Better Stack dashboards found.'),
  ],
}

type BetterStackData = Parameters<typeof buildBetterStackRows>[1]

/** What one page lists, each part read only when the integration holds the token it needs. */
async function readBetterStackPage(
  teamId: string,
  integration: BetterStackIntegration,
  page: BetterStackPage,
): Promise<Partial<BetterStackData>> {
  const { id, hasUptimeApiToken: uptime, hasTelemetryApiToken: telemetry } = integration

  if (page === 'monitors') {
    if (!uptime) return {}
    const [monitors, heartbeats] = await Promise.all([
      api.atlasListBetterStackMonitors(teamId, id),
      api.atlasListBetterStackHeartbeats(teamId, id),
    ])

    return { monitors, heartbeats }
  }
  if (page === 'incidents') {
    return uptime ? { incidents: await api.atlasListBetterStackIncidents(teamId, id) } : {}
  }
  if (page === 'dashboards') {
    return telemetry ? { dashboards: await api.atlasListBetterStackDashboards(teamId, id) } : {}
  }
  if (!telemetry) return {}
  const [sources, collectors] = await Promise.all([
    api.atlasListBetterStackSources(teamId, id),
    api.atlasListBetterStackCollectors(teamId, id),
  ])

  return { sources, collectors }
}

export function BetterStackIntegrationView({
  integration,
  ...props
}: CommonProps & {
  teamId: string
  integration: BetterStackIntegration | undefined
  page: BetterStackPage
}) {
  if (!integration) {
    return <ErrorBlock message={t('Better Stack integration not found.')} />
  }

  return <BetterStackPageView integration={integration} {...props} />
}

function BetterStackPageView({
  teamId,
  integration,
  page,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  teamId: string
  integration: BetterStackIntegration
  page: BetterStackPage
}) {
  const query = useQuery({
    // Adding or removing a token changes what the page can read.
    queryKey: queryKeys.betterStack(
      teamId,
      integration.id,
      page,
      `uptime:${String(integration.hasUptimeApiToken)}`,
      `telemetry:${String(integration.hasTelemetryApiToken)}`,
    ),
    queryFn: () => readBetterStackPage(teamId, integration, page),
  })
  const loading = query.isPending
  const error = query.error ? parseAtlasError(query.error).message : null

  useRefreshKey(query, refreshKey, onLoading)

  const rows = buildBetterStackRows(page, {
    monitors: [],
    heartbeats: [],
    incidents: [],
    dashboards: [],
    sources: [],
    collectors: [],
    ...query.data,
  })
  const filtered = applyFilter(
    rows,
    filter,
    (row) => `${row.kind} ${row.name} ${row.detail} ${row.status ?? ''}`,
  )

  const requiredToken: 'uptime' | 'telemetry' =
    page === 'sources' || page === 'dashboards' ? 'telemetry' : 'uptime'
  const hasRequiredToken =
    requiredToken === 'telemetry' ? integration.hasTelemetryApiToken : integration.hasUptimeApiToken
  const showKindColumn = page === 'sources' || page === 'monitors'

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

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
        empty={EMPTY_TEXT[page][loading ? 0 : !hasRequiredToken ? 1 : filter ? 2 : 3]}
        storageKey={`betterstack.${page}`}
        columns={[
          ...(showKindColumn
            ? [
                {
                  key: 'kind',
                  header: t('Kind'),
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
            header: t('Name'),
            width: 300,
            sortAccessor: (row) => row.name,
            render: (row) => <span className="text-main font-medium truncate">{row.name}</span>,
          },
          ...(page === 'dashboards'
            ? []
            : [
                {
                  key: 'detail',
                  header: page === 'incidents' ? t('Cause') : t('Detail'),
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
                  header: t('Status'),
                  width: 140,
                  sortAccessor: (row: BetterStackRow) => row.status ?? '',
                  render: (row: BetterStackRow) => <StatusBadge status={row.status ?? 'unknown'} />,
                },
              ]),
          {
            key: 'updated',
            header: page === 'incidents' ? t('Last event') : t('Updated'),
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
