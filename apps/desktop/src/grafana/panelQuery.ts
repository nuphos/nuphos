import { defaultIntervalMs, substituteMacros, substituteVars } from './model.ts'

import type { Panel, TimeRange } from './types.ts'

export type PanelQueryOptions = {
  range: TimeRange
  intervalMs?: number
  maxDataPoints?: number
  variables?: Record<string, string>
  datasourceVariables?: Record<string, string[]>
}

export type PanelQueryGroup = { queries: Record<string, unknown>[] }

// Build one query group per concrete datasource. Grafana's dashboard model can
// put a multi-select datasource variable directly in `datasource.uid`; each
// selected UID must be queried independently while the original target refIds
// stay intact for legends, styles, and table transformations.
export function buildPanelQueryGroups(panel: Panel, opts: PanelQueryOptions): PanelQueryGroup[] {
  const intervalMs = opts.intervalMs ?? defaultIntervalMs(opts.range)
  const vars = opts.variables ?? {}
  const datasourceVars = opts.datasourceVariables ?? {}
  const groups = new Map<string, Record<string, unknown>[]>()

  for (const target of panel.targets) {
    const datasourceTemplate = target.datasource ?? panel.datasource

    if (!datasourceTemplate) continue
    const variableName = exactVariableReference(datasourceTemplate.uid)
    const selectedUids = variableName ? datasourceVars[variableName] : undefined
    const uids = selectedUids ?? [substituteVars(datasourceTemplate.uid, vars)]

    for (const uid of uids) {
      const query = buildQuery(target, { ...datasourceTemplate, uid }, opts, intervalMs)
      const key = `${datasourceTemplate.type}\u0000${uid}`
      const group = groups.get(key)

      if (group) group.push(query)
      else groups.set(key, [query])
    }
  }

  return [...groups.values()].map((queries) => ({ queries }))
}

function buildQuery(
  target: Panel['targets'][number],
  datasource: NonNullable<Panel['datasource']>,
  opts: PanelQueryOptions,
  intervalMs: number,
): Record<string, unknown> {
  const vars = opts.variables ?? {}
  const query: Record<string, unknown> = {
    refId: target.refId,
    datasource,
    intervalMs,
    maxDataPoints: opts.maxDataPoints ?? 300,
  }

  if (target.expr) {
    query.expr = substituteVars(substituteMacros(target.expr, opts.range, intervalMs), vars)
    query.instant = target.instant === true
    query.range = target.range ?? target.instant !== true
  }
  if (target.rawSql) query.rawSql = substituteVars(target.rawSql, vars)
  if (target.query) query.query = substituteVars(target.query, vars)
  if (target.queryType) query.queryType = target.queryType
  if (target.legendFormat) query.legendFormat = target.legendFormat
  if (target.format) query.format = target.format

  return query
}

function exactVariableReference(uid: string): string | null {
  const bare = /^\$([a-zA-Z_]\w*)$/.exec(uid)

  if (bare) return bare[1]

  return /^\$\{([a-zA-Z_]\w*)\}$/.exec(uid)?.[1] ?? null
}
