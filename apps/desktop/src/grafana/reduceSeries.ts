// Grafana's `reduceOptions` applied to query results: the one-value-per-series
// model that the pie chart, bar gauge, gauge and stat panels all render from.
// Rendering lives in components/.

import { renderLegend } from './format.ts'

import type { DataFrame, Field, Panel } from './types'

export type SeriesValue = { label: string; value: number }

export type ReduceOptions = {
  /** Grafana keeps a list but renders the first one. */
  calc: string
  /** `values: true` shows every row instead of reducing to one number. */
  values: boolean
  limit: number | null
}

const CALCS = new Map<string, (values: number[]) => number>([
  ['lastNotNull', (v) => v[v.length - 1] ?? 0],
  ['last', (v) => v[v.length - 1] ?? 0],
  ['firstNotNull', (v) => v[0] ?? 0],
  ['first', (v) => v[0] ?? 0],
  ['min', (v) => Math.min(...v)],
  ['max', (v) => Math.max(...v)],
  ['mean', (v) => v.reduce((sum, n) => sum + n, 0) / v.length],
  ['sum', (v) => v.reduce((sum, n) => sum + n, 0)],
  ['total', (v) => v.reduce((sum, n) => sum + n, 0)],
  ['count', (v) => v.length],
  ['range', (v) => Math.max(...v) - Math.min(...v)],
  ['diff', (v) => (v[v.length - 1] ?? 0) - (v[0] ?? 0)],
])

export function reduceOptionsFor(panel: Panel): ReduceOptions {
  const raw = panel.options?.reduceOptions

  if (typeof raw !== 'object' || raw === null)
    return { calc: 'lastNotNull', values: false, limit: null }
  const options = raw as { calcs?: unknown; values?: unknown; limit?: unknown }
  const calcs = Array.isArray(options.calcs) ? options.calcs : []
  const calc = calcs.find((item): item is string => typeof item === 'string')

  return {
    calc: calc ?? 'lastNotNull',
    values: options.values === true,
    limit: typeof options.limit === 'number' ? options.limit : null,
  }
}

/** Finite numbers only — a gap in the series is not a zero. */
function numericValues(field: Field): number[] {
  const out: number[] = []

  for (const raw of field.values) {
    if (raw == null) continue
    const value = Number(raw)

    if (Number.isFinite(value)) out.push(value)
  }

  return out
}

function seriesLabel(frame: DataFrame, field: Field, panel: Panel): string {
  const displayName = field.config?.displayName

  if (displayName) return displayName
  const legendFormat = panel.targets.find((target) => target.refId === frame.refId)?.legendFormat
  const fallback = field.config?.displayNameFromDS ?? frame.name ?? field.name

  return renderLegend(field.labels, legendFormat, fallback)
}

function labelText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return ''
}

/** Row labels for `values: true`: the frame's string column, when it has one. */
function rowLabels(frame: DataFrame): string[] | null {
  const stringField = frame.fields.find((field) => field.type === 'string')

  if (!stringField) return null

  return stringField.values.map(labelText)
}

/**
 * One entry per series (or per row, under `values: true`), in query order.
 * Series with no finite value at all are dropped — Grafana renders nothing for
 * them, and a zero would be a different claim.
 */
export function reduceSeries(frames: DataFrame[], panel: Panel): SeriesValue[] {
  const options = reduceOptionsFor(panel)
  const reduce = CALCS.get(options.calc) ?? CALCS.get('lastNotNull')
  const out: SeriesValue[] = []

  for (const frame of frames) {
    const labels = options.values ? rowLabels(frame) : null

    for (const field of frame.fields) {
      if (field.type !== 'number') continue
      const label = seriesLabel(frame, field, panel)

      if (options.values) {
        appendRows(out, field, label, labels)
        continue
      }
      const values = numericValues(field)

      if (values.length === 0) continue
      out.push({ label, value: reduce?.(values) ?? 0 })
    }
  }

  return options.limit !== null && options.limit > 0 ? out.slice(0, options.limit) : out
}

function appendRows(
  out: SeriesValue[],
  field: Field,
  label: string,
  labels: string[] | null,
): void {
  for (const [index, raw] of field.values.entries()) {
    const value = Number(raw)

    if (raw == null || !Number.isFinite(value)) continue
    const rowLabel = labels?.[index] ?? ''

    out.push({ label: rowLabel === '' ? `${label} ${String(index + 1)}` : rowLabel, value })
  }
}
