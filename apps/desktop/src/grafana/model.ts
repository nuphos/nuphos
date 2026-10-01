// Pure Grafana dashboard-model helpers: raw-JSON normalization, template
// variable expansion, and time/macro substitution. No network, no React —
// unit-tested in model.test.ts; the API calls live in client.ts.

import type {
  Dashboard,
  DataFrame,
  Field,
  FieldType,
  Panel,
  PanelTarget,
  TimeRange,
  Variable,
} from './types'

export type RawDashboard = {
  uid: string
  title: string
  panels: RawPanel[]
  time?: { from?: string; to?: string }
  templating?: { list?: RawVariable[] }
}

type RawVariable = {
  name?: string
  label?: string
  type?: string
  query?: string | { query?: string }
  regex?: string
  multi?: boolean
  includeAll?: boolean
  allValue?: string
  datasource?: { uid?: string; type?: string }
  current?: { text?: string | string[]; value?: string | string[] }
}

type RawPanel = {
  id: number
  type: string
  title?: string
  gridPos?: { x: number; y: number; w: number; h: number }
  datasource?: { uid?: string; type?: string }
  targets?: Record<string, unknown>[]
  fieldConfig?: Panel['fieldConfig']
  options?: Record<string, unknown>
  transformations?: { id?: string; options?: Record<string, unknown> }[]
  collapsed?: boolean
  panels?: RawPanel[]
  repeat?: string
}

export function normalizeDashboard(raw: RawDashboard): Dashboard {
  return {
    uid: raw.uid,
    title: raw.title,
    panels: (raw.panels || []).map(normalizePanel),
    time: { from: raw.time?.from || 'now-1h', to: raw.time?.to || 'now' },
    variables: (raw.templating?.list || []).map(normalizeVariable),
  }
}

function normalizeVariable(raw: RawVariable): Variable {
  const type = (raw.type ?? 'unknown') as Variable['type']
  const rawValue = raw.current?.value
  const rawText = raw.current?.text
  const values = (Array.isArray(rawValue) ? rawValue : rawValue == null ? [] : [rawValue]).map(
    String,
  )
  const texts = (Array.isArray(rawText) ? rawText : rawText == null ? [] : [rawText]).map(String)
  const queryStr =
    typeof raw.query === 'string'
      ? raw.query
      : raw.query && typeof raw.query === 'object'
        ? (raw.query.query ?? '')
        : undefined

  return {
    name: raw.name ?? '',
    label: raw.label,
    type,
    currentValue: values[0] ?? '',
    currentText: texts[0] ?? values[0] ?? '',
    currentValues: values,
    currentTexts: texts.length === values.length ? texts : values,
    multi: raw.multi,
    includeAll: raw.includeAll,
    allValue: raw.allValue || undefined,
    query: type === 'query' ? queryStr : undefined,
    optionsRegex: type === 'query' ? raw.regex || undefined : undefined,
    datasource:
      raw.datasource?.uid && raw.datasource.type
        ? { uid: raw.datasource.uid, type: raw.datasource.type }
        : undefined,
    datasourceTypeFilter: type === 'datasource' ? queryStr : undefined,
    datasourceNameRegex: type === 'datasource' ? raw.regex : undefined,
  }
}

export const ALL_VALUE = '$__all'

// Resolve the selected values of a variable to the string substituted into
// queries. Multi/includeAll variables are used in `=~"$var"` matchers, so they
// expand the way Grafana does: `$__all` → allValue (or match-everything),
// several picks → an alternation of escaped values.
export function variableQueryValue(v: Variable, selected: string[]): string {
  if (!v.multi && !v.includeAll) return selected[0] ?? ''
  if (selected.length === 0 || selected.includes(ALL_VALUE)) {
    return v.allValue || '.*'
  }
  // Multi variables land in `=~"$var"` matchers, so even a single pick must
  // be escaped or values like "api.v1" also match "api-v1".
  if (selected.length === 1) return escapeRegex(selected[0])

  return `(${selected.map(escapeRegex).join('|')})`
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&')
}

function normalizePanel(raw: RawPanel): Panel {
  return {
    id: raw.id,
    type: raw.type,
    title: raw.title || '',
    gridPos: raw.gridPos || { x: 0, y: 0, w: 24, h: 8 },
    datasource:
      raw.datasource?.uid && raw.datasource.type
        ? { uid: raw.datasource.uid, type: raw.datasource.type }
        : undefined,
    targets: (raw.targets || []).map(normalizeTarget),
    fieldConfig: raw.fieldConfig,
    options: raw.options,
    transformations: (raw.transformations || []).filter(
      (t): t is { id: string; options?: Record<string, unknown> } => !!t.id,
    ),
    collapsed: raw.collapsed,
    panels: raw.type === 'row' ? (raw.panels || []).map(normalizePanel) : undefined,
    repeat: raw.repeat,
  }
}

function normalizeTarget(raw: Record<string, unknown>): PanelTarget {
  const ds = raw.datasource as { uid?: string; type?: string } | undefined

  return {
    refId: typeof raw.refId === 'string' ? raw.refId : 'A',
    datasource: ds?.uid && ds.type ? { uid: ds.uid, type: ds.type } : undefined,
    expr: typeof raw.expr === 'string' ? raw.expr : undefined,
    rawSql: typeof raw.rawSql === 'string' ? raw.rawSql : undefined,
    query: typeof raw.query === 'string' ? (raw.query as string) : undefined,
    queryType: typeof raw.queryType === 'string' ? raw.queryType : undefined,
    legendFormat: typeof raw.legendFormat === 'string' ? raw.legendFormat : undefined,
    format: typeof raw.format === 'string' ? raw.format : undefined,
    instant: typeof raw.instant === 'boolean' ? raw.instant : undefined,
    range: typeof raw.range === 'boolean' ? raw.range : undefined,
  }
}

// Apply a query variable's option regex the way Grafana does: values that
// don't match are dropped, and if the regex has a capture group the option
// becomes the first captured text (deduplicated).
export function applyVariableRegex(values: string[], regex: string | undefined): string[] {
  const re = parseGrafanaRegex(regex)

  if (!re) return values
  const out: string[] = []

  for (const v of values) {
    re.lastIndex = 0
    const m = re.exec(v)

    if (!m) continue
    out.push(m[1] ?? v)
  }

  return [...new Set(out)]
}

// Parse a Grafana-style regex (e.g. "/foo/" or "/foo/i") into a RegExp.
export function parseGrafanaRegex(s: string | undefined): RegExp | null {
  if (!s) return null
  const m = /^\/(.+)\/([a-z]*)$/i.exec(s)

  if (m) {
    try {
      return new RegExp(m[1], m[2])
    } catch {
      return null
    }
  }
  try {
    return new RegExp(s)
  } catch {
    return null
  }
}

// Resolve Grafana time strings (e.g., "now-1h", "now") to unix ms.
export function resolveTimeRange(from: string, to: string, nowMs = Date.now()): TimeRange {
  return { from: parseTime(from, nowMs), to: parseTime(to, nowMs) }
}

function parseTime(s: string, nowMs: number): number {
  if (s === 'now') return nowMs
  const m = /^now-(\d+)([smhdw])$/.exec(s)

  if (m) {
    const n = parseInt(m[1], 10)
    const mult = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 }[m[2]] ?? 0

    return nowMs - n * mult
  }
  const ts = Number(s)

  if (Number.isFinite(ts)) return ts

  return nowMs
}

// Substitute basic Grafana macros so that PromQL queries from the dashboard
// work without the Grafana templating engine.
export function substituteMacros(expr: string, range: TimeRange, intervalMs: number): string {
  const rangeSec = Math.max(1, Math.round((range.to - range.from) / 1000))
  const intervalStr = formatDuration(intervalMs)

  return expr
    .replace(/\$__rate_interval/g, intervalStr)
    .replace(/\$__interval/g, intervalStr)
    .replace(/\$__range/g, `${String(rangeSec)}s`)
}

// Replace Grafana template variable references (`${name}` and `$name`) with
// their resolved values. Unknown variables are left as-is so the resulting
// error from the Grafana API points at the missing one.
export function substituteVars(s: string, vars: Record<string, string>): string {
  return s
    .replace(/\$\{([a-zA-Z_]\w*)\}/g, (_, name: string) =>
      name in vars ? vars[name] : `\${${name}}`,
    )
    .replace(/\$([a-zA-Z_]\w*)/g, (_, name: string) => (name in vars ? vars[name] : `$${name}`))
}

function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))

  if (s % 86400 === 0) return `${String(s / 86400)}d`
  if (s % 3600 === 0) return `${String(s / 3600)}h`
  if (s % 60 === 0) return `${String(s / 60)}m`

  return `${String(s)}s`
}

export function defaultIntervalMs(range: TimeRange): number {
  const span = range.to - range.from
  const ideal = Math.max(15_000, Math.round(span / 300))
  const steps = [15_000, 30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]

  return steps.find((s) => s >= ideal) ?? ideal
}

export type RawFrame = {
  schema?: {
    name?: string
    refId?: string
    fields?: {
      name?: string
      type?: string
      labels?: Record<string, string>
      config?: Field['config']
    }[]
    meta?: DataFrame['meta']
  }
  data?: { values?: unknown[][] }
}

export function normalizeFrame(raw: RawFrame, fallbackRef: string): DataFrame {
  const fields = (raw.schema?.fields || []).map<Field>((f, i) => ({
    name: f.name || `f${String(i)}`,
    type: (f.type as FieldType) || 'other',
    labels: f.labels,
    config: f.config,
    values: raw.data?.values?.[i] || [],
  }))

  return {
    name: raw.schema?.name,
    refId: raw.schema?.refId || fallbackRef,
    fields,
    meta: raw.schema?.meta,
  }
}
