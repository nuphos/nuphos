import { api } from '../../api'
import { createReportedError } from '../../lib/frontendErrorReporter'
import { normalizeFrame } from '../model'

import type { RawFrame } from '../model'
import type { DataFrame } from '../types'

// All Grafana traffic is forwarded through the Nuphos backend's proxy:
//   POST /teams/{teamId}/grafana-instances/{instanceId}/proxy/<grafana-path>
// The renderer never speaks to Grafana directly, so credentials and CORS are
// handled by the backend.
export type GrafanaTarget = {
  teamId: string
  instanceId: string
}

export async function proxy<T>(
  target: GrafanaTarget,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return api.atlasGrafanaProxy<T>(target.teamId, target.instanceId, method, path, body)
}

export type DatasourceSummary = {
  uid: string
  name: string
  type: string
}

export function isTempoDatasource(ds: DatasourceSummary): boolean {
  return ds.type.toLowerCase().includes('tempo')
}

export function isLokiDatasource(ds: DatasourceSummary): boolean {
  return ds.type.toLowerCase().includes('loki')
}

export async function listDatasources(target: GrafanaTarget): Promise<DatasourceSummary[]> {
  const items = await proxy<{ uid: string; name: string; type: string }[]>(
    target,
    'GET',
    `/api/datasources`,
  )

  return items.map((x) => ({ uid: x.uid, name: x.name, type: x.type }))
}

export type RawResult = {
  status?: number
  error?: string
  frames?: RawFrame[]
}

// The HTTP status of a /api/ds/query call is the worst of its per-refId
// statuses, so the body is the only place that says which query failed and
// why — a failed one carries `error`, with or without a `status`.
export function framesFromResults(
  res: { results?: Record<string, RawResult> },
  label: string,
): DataFrame[] {
  const out: DataFrame[] = []

  for (const [refId, result] of Object.entries(res.results ?? {})) {
    if (result.error || (result.status !== undefined && result.status >= 400)) {
      throw createReportedError({
        source: 'grafana',
        phase: 'query_result_error',
        message: result.error || `${label} ${refId} failed (status ${String(result.status)})`,
        refId,
        status: result.status,
      })
    }
    for (const frame of result.frames ?? []) {
      out.push(normalizeFrame(frame, refId))
    }
  }

  return out
}
