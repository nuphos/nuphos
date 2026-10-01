import { applyVariableRegex, normalizeDashboard, substituteVars } from '../model'
import { buildPanelQueryGroups } from '../panelQuery'
import { createReportedError } from '../../lib/frontendErrorReporter'

import { framesFromResults, proxy } from './base'

import type { RawDashboard } from '../model'
import type { PanelQueryGroup, PanelQueryOptions } from '../panelQuery'
import type { Dashboard, DataFrame, Panel, TimeRange, Variable } from '../types'
import type { GrafanaTarget, RawResult } from './base'

export type DashboardSummary = {
  uid: string
  title: string
  folderTitle?: string
  tags: string[]
}

export async function listDashboards(target: GrafanaTarget): Promise<DashboardSummary[]> {
  const items = await proxy<
    { uid: string; title: string; folderTitle?: string; tags?: string[] }[]
  >(target, 'GET', `/api/search?type=dash-db&limit=200`)

  return items.map((x) => ({
    uid: x.uid,
    title: x.title,
    folderTitle: x.folderTitle,
    tags: x.tags ?? [],
  }))
}

export async function getDashboard(target: GrafanaTarget, uid: string): Promise<Dashboard> {
  const raw = await proxy<{ dashboard: RawDashboard }>(
    target,
    'GET',
    `/api/dashboards/uid/${encodeURIComponent(uid)}`,
  )

  return normalizeDashboard(raw.dashboard)
}

// Fetch the options of a `label_values(...)` query variable through the
// Grafana datasource resource proxy (Prometheus label-values API).
export async function queryVariableOptions(
  target: GrafanaTarget,
  variable: Variable,
  vars: Record<string, string>,
  range: TimeRange,
): Promise<string[]> {
  if (variable.type !== 'query' || !variable.query || !variable.datasource) return []
  const m = /^label_values\((?:(.*),)?\s*([a-zA-Z_][a-zA-Z0-9_:]*)\s*\)$/s.exec(
    variable.query.trim(),
  )

  if (!m) {
    // Surface unsupported forms (query_result(...), metrics(...)) instead of
    // rendering an indistinguishable "No matches".
    throw createReportedError({
      source: 'grafana',
      phase: 'unsupported_variable_query',
      message: `Unsupported variable query: ${variable.query}`,
    })
  }
  const uid = substituteVars(variable.datasource.uid, vars)
  const params = new URLSearchParams()

  params.set('start', String(Math.floor(range.from / 1000)))
  params.set('end', String(Math.ceil(range.to / 1000)))
  if (m[1]) params.append('match[]', substituteVars(m[1].trim(), vars))
  const res = await proxy<{ status?: string; error?: string; data?: string[] }>(
    target,
    'GET',
    `/api/datasources/uid/${encodeURIComponent(uid)}/resources/api/v1/label/${encodeURIComponent(m[2])}/values?${params.toString()}`,
  )

  if (res.status && res.status !== 'success') {
    throw createReportedError({
      source: 'grafana',
      phase: 'variable_query_result_error',
      message: res.error || `Variable query failed (status: ${res.status})`,
      status: res.status,
    })
  }

  return applyVariableRegex(res.data ?? [], variable.optionsRegex).sort((a, b) =>
    a.localeCompare(b),
  )
}

export type QueryOptions = PanelQueryOptions
export type { PanelQueryGroup }

export async function queryPanel(
  target: GrafanaTarget,
  panel: Panel,
  opts: QueryOptions,
): Promise<DataFrame[]> {
  const groups = buildPanelQueryGroups(panel, opts)

  if (groups.length === 0) return []
  const results = await Promise.all(
    groups.map(({ queries }) =>
      proxy<{ results: Record<string, RawResult> }>(target, 'POST', `/api/ds/query`, {
        queries,
        from: String(opts.range.from),
        to: String(opts.range.to),
      }),
    ),
  )

  return results.flatMap((res) => framesFromResults(res, 'Query'))
}
