import { apiUrl } from '../api-endpoint.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from '../client-version'
import { classifyGrafanaFailure, summarizeGrafanaBody } from '../grafanaProxyError'

import { call, fetchWithRetry, readToken, unwrapFetchError } from './client'

export type GrafanaInstance = {
  id: string
  name: string
  grafanaUrl: string
  createdAt?: string
}

export async function listGrafanaInstances(teamId: string): Promise<GrafanaInstance[]> {
  const data = await call<{ instances?: GrafanaInstance[] } | GrafanaInstance[]>(
    'GET',
    `/teams/${teamId}/grafana-instances`,
  )

  // Backend may wrap in { instances } or return a bare array — accept both.
  if (Array.isArray(data)) return data

  return data.instances ?? []
}

export async function bindGrafanaInstance(
  teamId: string,
  name: string,
  grafanaUrl: string,
  saToken: string,
): Promise<GrafanaInstance> {
  return call<GrafanaInstance>('POST', `/teams/${teamId}/grafana-instances`, {
    name,
    grafanaUrl,
    saToken,
  })
}

export async function unbindGrafanaInstance(teamId: string, instanceId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/grafana-instances/${instanceId}`)
}

// `body` is JSON-serialized when present.
export async function grafanaProxy<T>(
  teamId: string,
  instanceId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await readToken()

  if (!token) throw new Error('Not signed in')
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const route = `/teams/${teamId}/grafana-instances/${instanceId}/proxy/${cleanPath}`
  // Disable compression — the Nuphos backend proxy currently mis-handles
  // Content-Encoding (forwards the gzip header but ships decoded bytes), which
  // makes undici fail with `Z_DATA_ERROR: incorrect header check`.
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'accept-encoding': 'identity',
    [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE,
  }
  const init: RequestInit = { method, headers }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
    headers['content-type'] = 'application/json'
  }
  let res: Response

  try {
    res = await fetchWithRetry(`${apiUrl()}${route}`, init)
  } catch (e) {
    throw unwrapFetchError(e, route)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const failure = classifyGrafanaFailure(res.status, text)

    if (failure.kind === 'query-results') return failure.body as T
    console.warn(
      `[grafana] ${method} ${cleanPath} failed: ${failure.message}`,
      summarizeGrafanaBody(res.status, text),
    )
    throw new Error(failure.message)
  }
  if (res.status === 204) return undefined as T

  return (await res.json()) as T
}

// ---------- Monitoring overview (BYOS aggregation) ----------

export type MonitoringOverviewRowDTO = {
  provider: 'betterstack' | 'grafana' | 'gcp'
  integrationId: string
  integrationLabel: string
  providerResourceId: string
  kind: 'monitor' | 'heartbeat' | 'alert-rule' | 'alert-policy' | 'uptime-check'
  name: string
  status: 'up' | 'down' | 'paused' | 'pending' | 'unknown'
  statusLabel: string
  target: string | null
  lastIncidentAt: string | null
  providerUrl: string | null
}

export type MonitoringOverviewDTO = {
  rows: MonitoringOverviewRowDTO[]
  providerErrors: {
    provider: 'betterstack' | 'grafana' | 'gcp'
    integrationId: string
    integrationLabel: string
    message: string
  }[]
}

export async function getMonitoringOverview(teamId: string): Promise<MonitoringOverviewDTO> {
  return call<MonitoringOverviewDTO>('GET', `/teams/${teamId}/monitoring/overview`)
}
