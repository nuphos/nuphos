import { framesFromResults, proxy } from './base'

import type { DataFrame } from '../types'
import type { GrafanaTarget, RawResult } from './base'

export async function queryLokiLogs(
  target: GrafanaTarget,
  datasourceUid: string,
  opts: {
    expr: string
    startMs: number
    endMs: number
    maxLines: number
  },
): Promise<DataFrame[]> {
  const res = await proxy<{ results: Record<string, RawResult> }>(target, 'POST', `/api/ds/query`, {
    queries: [
      {
        refId: 'A',
        datasource: { type: 'loki', uid: datasourceUid },
        expr: opts.expr,
        queryType: 'range',
        maxLines: opts.maxLines,
        direction: 'backward',
      },
    ],
    from: String(opts.startMs),
    to: String(opts.endMs),
  })

  return framesFromResults(res, 'Loki query')
}

// Loki metadata through Grafana's datasource resource proxy. The loki plugin
// registers its resource routes WITHOUT the `loki/api/v1` prefix (`labels`,
// `label/<name>/values`, `series`, …); start/end are epoch nanoseconds.
async function lokiResource<T>(
  target: GrafanaTarget,
  datasourceUid: string,
  path: string,
  windowMs: { startMs: number; endMs: number },
): Promise<T> {
  const params = new URLSearchParams()

  params.set('start', String(windowMs.startMs * 1e6))
  params.set('end', String(windowMs.endMs * 1e6))

  return proxy<T>(
    target,
    'GET',
    `/api/datasources/uid/${encodeURIComponent(datasourceUid)}/resources/${path}?${params.toString()}`,
  )
}

export async function listLokiLabels(
  target: GrafanaTarget,
  datasourceUid: string,
  windowMs: { startMs: number; endMs: number },
): Promise<string[]> {
  const res = await lokiResource<{ status?: string; data?: string[] }>(
    target,
    datasourceUid,
    'labels',
    windowMs,
  )

  return (res.data ?? []).filter((x) => !x.startsWith('__')).sort((a, b) => a.localeCompare(b))
}

export async function listLokiLabelValues(
  target: GrafanaTarget,
  datasourceUid: string,
  label: string,
  windowMs: { startMs: number; endMs: number },
): Promise<string[]> {
  const res = await lokiResource<{ status?: string; data?: string[] }>(
    target,
    datasourceUid,
    `label/${encodeURIComponent(label)}/values`,
    windowMs,
  )

  return (res.data ?? []).sort((a, b) => a.localeCompare(b))
}
