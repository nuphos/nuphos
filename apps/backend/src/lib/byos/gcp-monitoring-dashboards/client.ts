import { impersonateSa } from '@/lib/byos/gcp'
import { AppError } from '@/lib/errors'

import { BoundedTtlCache } from './cache'

import type { GcpMonitoringDashboardSummary, RawDashboard } from './types'
import type { GcpHandle } from '@/lib/byos/gcp'

const DASHBOARD_BASE = 'https://monitoring.googleapis.com/v1'

export const MONITORING_BASE = 'https://monitoring.googleapis.com/v3'
const DASHBOARD_CACHE_TTL_MS = 60_000
const LIST_CACHE_TTL_MS = 2 * 60_000

export const METRIC_UNIT_CACHE_TTL_MS = 10 * 60_000
const LIST_CACHE_MAX_ENTRIES = 128
const DASHBOARD_CACHE_MAX_ENTRIES = 512

export const METRIC_UNIT_CACHE_MAX_ENTRIES = 1_024
export const TIME_SERIES_PAGE_SIZE = 20_000
export const MAX_QUERY_POINTS = 100_000
export const MAX_QUERY_PAGES = 10

export async function accessTokenFor(handle: GcpHandle): Promise<string> {
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const { token } = await impersonated.getAccessToken()

  if (!token) {
    throw new AppError(502, 'gcp_token_failed', 'Failed to obtain an impersonated GCP access token')
  }

  return token
}

export async function gcpGet<T>(url: string, token: string, timeoutMs = 45_000): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')

    if (res.status === 403) {
      throw new AppError(
        403,
        'gcp_monitoring_permission_denied',
        'Cloud Monitoring denied dashboard access — grant roles/monitoring.viewer or monitoring.dashboards.list/get plus monitoring.timeSeries.list to the bound service account',
      )
    }
    if (res.status === 404) {
      throw new AppError(
        404,
        'gcp_dashboard_not_found',
        'The Cloud Monitoring dashboard no longer exists',
      )
    }
    const detail = body ? `: ${body.slice(0, 300)}` : ''

    throw new AppError(
      502,
      'gcp_monitoring_dashboard_error',
      `Cloud Monitoring returned HTTP ${String(res.status)}${detail}`,
    )
  }

  return (await res.json()) as T
}

export function bindingCacheKey(handle: GcpHandle): string {
  return `${handle.projectId}\0${handle.serviceAccountEmail}`
}

export function dashboardIdFromName(name: string | undefined): string {
  const id = name?.split('/').pop()?.trim()

  return id || ''
}

export function dashboardConsoleUrl(projectId: string, dashboardId: string): string {
  return `https://console.cloud.google.com/monitoring/dashboards/builder/${encodeURIComponent(dashboardId)}?project=${encodeURIComponent(projectId)}`
}

const listCache = new BoundedTtlCache<GcpMonitoringDashboardSummary[]>(
  LIST_CACHE_TTL_MS,
  LIST_CACHE_MAX_ENTRIES,
)

export async function listGcpMonitoringDashboards(
  handle: GcpHandle,
): Promise<GcpMonitoringDashboardSummary[]> {
  const cacheKey = bindingCacheKey(handle)
  const cached = listCache.get(cacheKey)

  if (cached) return cached

  const token = await accessTokenFor(handle)
  const dashboards: GcpMonitoringDashboardSummary[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({ pageSize: '1000' })

    if (pageToken) params.set('pageToken', pageToken)
    const body = await gcpGet<{ dashboards?: RawDashboard[]; nextPageToken?: string }>(
      `${DASHBOARD_BASE}/projects/${encodeURIComponent(handle.projectId)}/dashboards?${params.toString()}`,
      token,
    )

    for (const dashboard of body.dashboards ?? []) {
      const id = dashboardIdFromName(dashboard.name)

      if (!id || !dashboard.name) continue
      dashboards.push({
        id,
        name: dashboard.name,
        displayName: dashboard.displayName?.trim() || id,
        labels: dashboard.labels ?? {},
        consoleUrl: dashboardConsoleUrl(handle.projectId, id),
      })
    }
    pageToken = body.nextPageToken
  } while (pageToken)

  dashboards.sort((a, b) => a.displayName.localeCompare(b.displayName))
  listCache.set(cacheKey, dashboards)

  return dashboards
}

const dashboardCache = new BoundedTtlCache<RawDashboard>(
  DASHBOARD_CACHE_TTL_MS,
  DASHBOARD_CACHE_MAX_ENTRIES,
)

export async function getRawDashboard(
  handle: GcpHandle,
  dashboardId: string,
): Promise<RawDashboard> {
  const cacheKey = `${bindingCacheKey(handle)}\0${dashboardId}`
  const cached = dashboardCache.get(cacheKey)

  if (cached) return cached

  const token = await accessTokenFor(handle)
  const raw = await gcpGet<RawDashboard>(
    `${DASHBOARD_BASE}/projects/${encodeURIComponent(handle.projectId)}/dashboards/${encodeURIComponent(dashboardId)}`,
    token,
  )

  dashboardCache.set(cacheKey, raw)

  return raw
}
