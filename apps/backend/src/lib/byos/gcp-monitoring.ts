// GCP Cloud Monitoring (Monitoring v3) — metric descriptors + time series for
// the desktop's native Metrics Explorer. Query parameters (filter, alignment,
// reducer) are passed through to the API natively; Nuphos stores nothing and
// defines no query language of its own.

import { impersonateSa } from '@/lib/byos/gcp'
import { AppError } from '@/lib/errors'

import type { GcpHandle } from '@/lib/byos/gcp'

const MONITORING_BASE = 'https://monitoring.googleapis.com/v3'

// Deliberately omits `description`: it's ~200+ chars per descriptor and a
// project exposes thousands — the desktop caches the catalog in localStorage,
// where that field alone would triple the footprint without being displayed.
export type GcpMetricDescriptor = {
  type: string
  displayName: string
  kind: string
  valueType: string
  unit: string
  // e.g. ['gce_instance'] — which monitored resources emit this metric.
  resourceTypes: string[]
}

export type GcpTimeSeries = {
  // Merged metric + resource labels, e.g. {instance_name: 'server-1', zone: '…'}.
  labels: Record<string, string>
  resourceType: string
  // Epoch ms + value, oldest first (chart-ready).
  points: [number, number | null][]
}

async function accessTokenFor(handle: GcpHandle): Promise<string> {
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const { token } = await impersonated.getAccessToken()

  if (!token)
    throw new AppError(502, 'gcp_token_failed', 'Failed to obtain an impersonated GCP access token')

  return token
}

async function monitoringGet<T>(
  handle: GcpHandle,
  token: string,
  resource: string,
  params: URLSearchParams,
): Promise<T> {
  const res = await fetch(
    `${MONITORING_BASE}/projects/${encodeURIComponent(handle.projectId)}/${resource}?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      // Fleet-sized timeSeries responses (dozens of series × hundreds of
      // points) can take GCP well over 20s to assemble.
      signal: AbortSignal.timeout(45_000),
    },
  )

  if (!res.ok) {
    if (res.status === 403) {
      throw new AppError(
        403,
        'gcp_monitoring_permission_denied',
        `Cloud Monitoring returned 403 for ${handle.projectId} — grant roles/monitoring.viewer to the bound service account`,
      )
    }
    const body = await res.text().catch(() => '')
    const detail = body ? `: ${body.slice(0, 200)}` : ''

    throw new AppError(
      502,
      'gcp_monitoring_error',
      `Cloud Monitoring ${resource} returned HTTP ${String(res.status)}${detail}`,
    )
  }

  return (await res.json()) as T
}

// The catalog changes rarely (new metric TYPES, not data) but costs several
// serial paginated calls — cache per project + credential for a few minutes.
const DESCRIPTOR_CACHE_TTL_MS = 10 * 60_000
const descriptorCache = new Map<string, { at: number; data: GcpMetricDescriptor[] }>()

/**
 * All metric descriptors for the project (paginated server-side, capped —
 * a project typically exposes 1.5–7k). The desktop filters client-side, so
 * one fetch per view open is enough.
 */
export async function listGcpMetricDescriptors(handle: GcpHandle): Promise<GcpMetricDescriptor[]> {
  // Keep bindings isolated: two service accounts for the same project can
  // have different Monitoring permissions, and a warm cache must not bypass
  // the permission check performed with the selected credential.
  const cacheKey = `${handle.projectId}\0${handle.serviceAccountEmail}`
  const cached = descriptorCache.get(cacheKey)

  if (cached && Date.now() - cached.at < DESCRIPTOR_CACHE_TTL_MS) return cached.data
  const token = await accessTokenFor(handle)
  const out: GcpMetricDescriptor[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      // The explorer is for data the project actually emits, not the thousands
      // of globally-defined metric types that would usually chart as empty.
      activeOnly: 'true',
      pageSize: '10000',
    })

    if (pageToken) params.set('pageToken', pageToken)
    const body = await monitoringGet<{
      metricDescriptors?: {
        type?: string
        displayName?: string
        description?: string
        metricKind?: string
        valueType?: string
        unit?: string
        monitoredResourceTypes?: string[]
      }[]
      nextPageToken?: string
    }>(handle, token, 'metricDescriptors', params)

    for (const d of body.metricDescriptors ?? []) {
      if (!d.type) continue
      out.push({
        type: d.type,
        displayName: d.displayName ?? d.type,
        kind: d.metricKind ?? '',
        valueType: d.valueType ?? '',
        unit: d.unit ?? '',
        resourceTypes: d.monitoredResourceTypes ?? [],
      })
    }
    pageToken = body.nextPageToken
  } while (pageToken)
  descriptorCache.set(cacheKey, { at: Date.now(), data: out })

  return out
}

const ALIGNERS = new Set([
  'ALIGN_MEAN',
  'ALIGN_MAX',
  'ALIGN_MIN',
  'ALIGN_SUM',
  'ALIGN_RATE',
  'ALIGN_DELTA',
  'ALIGN_COUNT',
  'ALIGN_PERCENTILE_50',
  'ALIGN_PERCENTILE_95',
  'ALIGN_PERCENTILE_99',
])
const REDUCERS = new Set([
  'REDUCE_NONE',
  'REDUCE_MEAN',
  'REDUCE_MAX',
  'REDUCE_MIN',
  'REDUCE_SUM',
  'REDUCE_COUNT',
])

export type GcpTimeSeriesQuery = {
  metricType: string
  startMs: number
  endMs: number
  alignmentSec: number
  aligner: string
  reducer?: string
  groupByFields?: string[]
}

export async function queryGcpTimeSeries(
  handle: GcpHandle,
  q: GcpTimeSeriesQuery,
): Promise<{ series: GcpTimeSeries[]; truncated: boolean }> {
  if (!ALIGNERS.has(q.aligner)) {
    throw new AppError(400, 'invalid_aligner', `Unsupported aligner: ${q.aligner}`)
  }
  if (q.reducer && !REDUCERS.has(q.reducer)) {
    throw new AppError(400, 'invalid_reducer', `Unsupported reducer: ${q.reducer}`)
  }
  const token = await accessTokenFor(handle)
  // timeSeries.list paginates on DATA POINTS, not series (a small pageSize
  // means dozens of serial round-trips on a fleet-sized project, and a series'
  // points can span pages) — so leave pageSize at its 100k-point default,
  // bound the page count, and merge fragments by series identity.
  const byKey = new Map<string, GcpTimeSeries>()
  let pageToken: string | undefined
  let pages = 0
  const MAX_PAGES = 4

  do {
    const params = new URLSearchParams({
      // Exact-match on the metric type; label narrowing happens client-side
      // on the returned series set for v1 (typical cardinality is small once
      // a reducer/group-by is applied).
      filter: `metric.type = "${q.metricType.replace(/"/g, '')}"`,
      'interval.startTime': new Date(q.startMs).toISOString(),
      'interval.endTime': new Date(q.endMs).toISOString(),
      'aggregation.alignmentPeriod': `${String(Math.max(60, Math.floor(q.alignmentSec)))}s`,
      'aggregation.perSeriesAligner': q.aligner,
      view: 'FULL',
    })

    if (q.reducer && q.reducer !== 'REDUCE_NONE') {
      params.set('aggregation.crossSeriesReducer', q.reducer)
      for (const f of q.groupByFields ?? []) {
        params.append('aggregation.groupByFields', f)
      }
    }
    if (pageToken) params.set('pageToken', pageToken)
    const body = await monitoringGet<{
      timeSeries?: {
        metric?: { labels?: Record<string, string> }
        resource?: { type?: string; labels?: Record<string, string> }
        valueType?: string
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
    }>(handle, token, 'timeSeries', params)

    for (const ts of body.timeSeries ?? []) {
      // Resource and metric labels can have the same key. Preserve their
      // namespaces so distinct time series never collapse into one cache key
      // and legends stay unambiguous.
      const labels = {
        ...Object.fromEntries(
          Object.entries(ts.resource?.labels ?? {}).map(([k, v]) => [`resource.${k}`, v]),
        ),
        ...Object.fromEntries(
          Object.entries(ts.metric?.labels ?? {}).map(([k, v]) => [`metric.${k}`, v]),
        ),
      }
      const resourceType = ts.resource?.type ?? ''
      const key = `${resourceType}|${Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',')}`
      let entry = byKey.get(key)

      if (!entry) {
        entry = { labels, resourceType, points: [] }
        byKey.set(key, entry)
      }
      for (const p of ts.points ?? []) {
        const t = p.interval?.endTime ? Date.parse(p.interval.endTime) : NaN

        if (!Number.isFinite(t)) continue
        const v = p.value ?? {}
        const value =
          v.doubleValue ??
          (v.int64Value != null ? Number(v.int64Value) : undefined) ??
          (v.boolValue != null ? Number(v.boolValue) : undefined) ??
          v.distributionValue?.mean ??
          null

        entry.points.push([t, value == null || !Number.isFinite(value) ? null : value])
      }
    }
    pageToken = body.nextPageToken
    pages += 1
  } while (pageToken && pages < MAX_PAGES)

  // The API returns points newest-first; charts want oldest-first.
  const series = Array.from(byKey.values())

  for (const s of series) s.points.sort((a, b) => a[0] - b[0])

  return { series, truncated: Boolean(pageToken) }
}
