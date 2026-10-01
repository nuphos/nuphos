import { AppError } from '@/lib/errors'

import {
  MAX_QUERY_PAGES,
  MAX_QUERY_POINTS,
  MONITORING_BASE,
  TIME_SERIES_PAGE_SIZE,
  accessTokenFor,
  gcpGet,
  getRawDashboard,
} from './client'
import { applyDashboardFilterSelections } from './filters'
import { widgetFromRef } from './layout'
import { querySourceType, widgetQueries } from './normalize'
import {
  addAggregationParams,
  autoAlignmentSeconds,
  inferMetricUnit,
  monitoringSeriesKey,
  pointValue,
  rankSeries,
  renderSeriesName,
} from './series'

import type {
  GcpMonitoringDashboardQueryResult,
  GcpMonitoringDashboardSeries,
  GcpMonitoringDashboardWidgetQueryInput,
  RawDashboardFilter,
  RawTimeSeriesFilter,
  RawTimeSeriesQuery,
  WidgetQueryEntry,
} from './types'
import type { GcpHandle } from '@/lib/byos/gcp'

function durationSeconds(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim())

  if (!match) return null
  const seconds = Number(match[1])

  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

async function executeStoredTimeSeriesFilter(
  handle: GcpHandle,
  token: string,
  filter: RawTimeSeriesFilter,
  query: RawTimeSeriesQuery,
  entry: WidgetQueryEntry,
  input: GcpMonitoringDashboardWidgetQueryInput,
  dashboardFilters: RawDashboardFilter[],
): Promise<GcpMonitoringDashboardQueryResult> {
  if (!filter.filter?.trim()) {
    throw new AppError(
      422,
      'gcp_dashboard_query_unsupported',
      'The saved widget query has no Monitoring filter',
    )
  }
  const savedAlignment = durationSeconds(filter.aggregation?.alignmentPeriod)
  const minAlignment = durationSeconds(entry.minAlignmentPeriod)
  const fullDuration = Math.max(60, Math.ceil((input.endMs - input.startMs) / 1000))
  const alignmentSeconds = query.outputFullDuration
    ? fullDuration
    : Math.max(
        autoAlignmentSeconds(input.startMs, input.endMs),
        savedAlignment ?? 0,
        minAlignment ?? 0,
      )

  const params = new URLSearchParams({
    filter: applyDashboardFilterSelections(filter.filter, dashboardFilters, input.filters),
    'interval.startTime': new Date(input.startMs).toISOString(),
    'interval.endTime': new Date(input.endMs).toISOString(),
    pageSize: String(TIME_SERIES_PAGE_SIZE),
    view: 'FULL',
  })

  addAggregationParams(params, 'aggregation', filter.aggregation, alignmentSeconds)
  addAggregationParams(
    params,
    'secondaryAggregation',
    filter.secondaryAggregation,
    alignmentSeconds,
  )

  const byKey = new Map<string, GcpMonitoringDashboardSeries>()
  let pageToken: string | undefined
  let pages = 0
  let pointCount = 0
  let truncated = false

  do {
    if (pageToken) params.set('pageToken', pageToken)
    else params.delete('pageToken')
    const body = await gcpGet<{
      timeSeries?: {
        metric?: { type?: string; labels?: Record<string, string> }
        resource?: { type?: string; labels?: Record<string, string> }
        points?: {
          interval?: { endTime?: string }
          value?: {
            doubleValue?: number
            int64Value?: string
            boolValue?: boolean
            distributionValue?: { mean?: number }
          }
        }[]
      }[]
      nextPageToken?: string
    }>(
      `${MONITORING_BASE}/projects/${encodeURIComponent(handle.projectId)}/timeSeries?${params.toString()}`,
      token,
    )

    for (const rawSeries of body.timeSeries ?? []) {
      const resourceType = rawSeries.resource?.type ?? ''
      const metricType = rawSeries.metric?.type ?? ''
      const labels = {
        ...Object.fromEntries(
          Object.entries(rawSeries.resource?.labels ?? {}).map(([key, value]) => [
            `resource.labels.${key}`,
            value,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(rawSeries.metric?.labels ?? {}).map(([key, value]) => [
            `metric.labels.${key}`,
            value,
          ]),
        ),
      }
      const key = monitoringSeriesKey(metricType, resourceType, labels)
      let item = byKey.get(key)

      if (!item) {
        item = {
          name: renderSeriesName(entry.legendTemplate, labels, metricType, resourceType),
          labels,
          resourceType,
          metricType,
          points: [],
        }
        byKey.set(key, item)
      }
      for (const point of rawSeries.points ?? []) {
        if (pointCount >= MAX_QUERY_POINTS) {
          truncated = true
          break
        }
        const timestamp = point.interval?.endTime ? Date.parse(point.interval.endTime) : NaN

        if (!Number.isFinite(timestamp)) continue
        item.points.push([timestamp, pointValue(point.value)])
        pointCount += 1
      }
      if (truncated) break
    }
    pageToken = body.nextPageToken
    pages += 1
    if (pageToken && pages >= MAX_QUERY_PAGES) truncated = true
  } while (pageToken && !truncated)

  const series = Array.from(byKey.values())

  for (const item of series) item.points.sort((a, b) => a[0] - b[0])

  return {
    series: rankSeries(series, filter.pickTimeSeriesFilter),
    truncated: truncated || Boolean(pageToken),
    unit: query.unitOverride ?? (await inferMetricUnit(handle, token, filter.filter)),
    sourceType: 'timeSeriesFilter',
  }
}

export async function queryGcpMonitoringDashboardWidget(
  handle: GcpHandle,
  dashboardId: string,
  input: GcpMonitoringDashboardWidgetQueryInput,
): Promise<GcpMonitoringDashboardQueryResult> {
  const raw = await getRawDashboard(handle, dashboardId)
  const widget = widgetFromRef(raw, input.widgetRef)

  if (!widget) {
    throw new AppError(
      404,
      'gcp_dashboard_widget_not_found',
      'The saved dashboard widget no longer exists',
    )
  }
  const entries = widgetQueries(widget)
  const entry = entries[input.datasetIndex]

  if (!entry) {
    throw new AppError(
      404,
      'gcp_dashboard_dataset_not_found',
      'The saved dashboard dataset no longer exists',
    )
  }
  const sourceType = querySourceType(entry.query)

  if (!entry.query.timeSeriesFilter) {
    throw new AppError(
      422,
      'gcp_dashboard_query_unsupported',
      `This dashboard query uses ${sourceType}, which is not supported in the first release. Open it in GCP to view the original data.`,
    )
  }

  const token = await accessTokenFor(handle)

  return executeStoredTimeSeriesFilter(
    handle,
    token,
    entry.query.timeSeriesFilter,
    entry.query,
    entry,
    input,
    raw.dashboardFilters ?? [],
  )
}
