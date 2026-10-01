import { BoundedTtlCache } from './cache'
import {
  METRIC_UNIT_CACHE_MAX_ENTRIES,
  METRIC_UNIT_CACHE_TTL_MS,
  MONITORING_BASE,
  bindingCacheKey,
  gcpGet,
} from './client'

import type { GcpMonitoringDashboardSeries, RawAggregation, RawTimeSeriesFilter } from './types'
import type { GcpHandle } from '@/lib/byos/gcp'

const metricUnitCache = new BoundedTtlCache<string | null>(
  METRIC_UNIT_CACHE_TTL_MS,
  METRIC_UNIT_CACHE_MAX_ENTRIES,
)

export async function inferMetricUnit(
  handle: GcpHandle,
  token: string,
  monitoringFilter: string,
): Promise<string | null> {
  const match = /\bmetric\.type\s*=\s*"([^"]+)"/.exec(monitoringFilter)
  const metricType = match?.[1]

  if (!metricType) return null
  const cacheKey = `${bindingCacheKey(handle)}\0${metricType}`
  const cached = metricUnitCache.get(cacheKey)

  if (cached !== undefined) return cached
  try {
    const descriptor = await gcpGet<{ unit?: string }>(
      `${MONITORING_BASE}/projects/${encodeURIComponent(handle.projectId)}/metricDescriptors/${encodeURIComponent(metricType)}`,
      token,
    )
    const unit = descriptor.unit?.trim() || null

    metricUnitCache.set(cacheKey, unit)

    return unit
  } catch {
    // Unit lookup is presentational. A descriptor permission/API mismatch must
    // not hide otherwise valid dashboard data.
    metricUnitCache.set(cacheKey, null)

    return null
  }
}

export function autoAlignmentSeconds(startMs: number, endMs: number): number {
  const ideal = Math.max(60, Math.ceil((endMs - startMs) / 300 / 1000))

  return Math.ceil(ideal / 60) * 60
}

export function addAggregationParams(
  params: URLSearchParams,
  prefix: 'aggregation' | 'secondaryAggregation',
  aggregation: RawAggregation | undefined,
  alignmentSeconds: number,
) {
  if (!aggregation) return
  const aligner = aggregation.perSeriesAligner

  if (aligner && aligner !== 'ALIGN_NONE') {
    params.set(
      `${prefix}.alignmentPeriod`,
      `${String(Math.max(60, Math.floor(alignmentSeconds)))}s`,
    )
    params.set(`${prefix}.perSeriesAligner`, aligner)
  }
  const reducer = aggregation.crossSeriesReducer

  if (reducer && reducer !== 'REDUCE_NONE') {
    params.set(`${prefix}.crossSeriesReducer`, reducer)
    for (const field of aggregation.groupByFields ?? []) {
      params.append(`${prefix}.groupByFields`, field)
    }
  }
}

export function pointValue(
  value:
    | {
        doubleValue?: number
        int64Value?: string
        boolValue?: boolean
        distributionValue?: { mean?: number }
      }
    | undefined,
): number | null {
  if (!value) return null
  const result =
    value.doubleValue ??
    (value.int64Value != null ? Number(value.int64Value) : undefined) ??
    (value.boolValue != null ? Number(value.boolValue) : undefined) ??
    value.distributionValue?.mean ??
    null

  return result == null || !Number.isFinite(result) ? null : result
}

export function renderSeriesName(
  template: string | undefined,
  labels: Record<string, string>,
  metricType: string,
  resourceType: string,
): string {
  if (template) {
    const rendered = template.replace(/\$\{([^}]+)\}/g, (_, key: string) => labels[key] ?? '')

    if (rendered.trim()) return rendered.trim()
  }
  const labelText = Object.entries(labels)
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/^(metric|resource)\.labels\./, '')}=${value}`)
    .join(', ')
  const metricLeaf = metricType.split('/').pop() || metricType

  return labelText || [metricLeaf, resourceType].filter(Boolean).join(' · ') || 'Series'
}

export function monitoringSeriesKey(
  metricType: string,
  resourceType: string,
  labels: Record<string, string>,
): string {
  return JSON.stringify([
    metricType,
    resourceType,
    Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)),
  ])
}

export function rankSeries(
  series: GcpMonitoringDashboardSeries[],
  pick: RawTimeSeriesFilter['pickTimeSeriesFilter'],
): GcpMonitoringDashboardSeries[] {
  const count = Math.max(1, Math.floor(pick?.numTimeSeries ?? series.length))

  if (!pick || count >= series.length) return series
  const valueFor = (item: GcpMonitoringDashboardSeries): number => {
    const values = item.points
      .map((point) => point[1])
      .filter((value): value is number => value != null)

    if (values.length === 0) return Number.NEGATIVE_INFINITY
    switch (pick.rankingMethod) {
      case 'METHOD_MIN':
        return Math.min(...values)
      case 'METHOD_MEAN':
        return values.reduce((sum, value) => sum + value, 0) / values.length
      case 'METHOD_SUM':
        return values.reduce((sum, value) => sum + value, 0)
      case 'METHOD_LATEST':
        return values[values.length - 1]!
      case 'METHOD_MAX':
      case undefined:
      default:
        return Math.max(...values)
    }
  }
  const direction = pick.direction === 'BOTTOM' ? 1 : -1

  return [...series].sort((a, b) => direction * (valueFor(a) - valueFor(b))).slice(0, count)
}
