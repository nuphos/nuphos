// Pure model for the Grafana "table" panel: merges instant-query series from
// all targets on their label sets ("merge" transformation), applies the
// "organize" exclude/rename options, and resolves per-column display config
// from fieldConfig overrides. Rendering lives in components/TablePanel.tsx.

import type { DataFrame, FieldOverride, Panel } from './types'

export type ValueColumn = {
  key: string
  title: string
  unit?: string
  decimals?: number
  thresholds?: { color: string; value: number | null }[]
  colorBackground: boolean
}

export type TableModel = {
  labelColumns: string[]
  labelTitles: Record<string, string>
  valueColumns: ValueColumn[]
  rows: { labels: Record<string, string>; values: Record<string, number | null> }[]
}

export function buildTable(frames: DataFrame[], panel: Panel): TableModel {
  const organize = panel.transformations?.find((t) => t.id === 'organize')?.options as
    { excludeByName?: Record<string, boolean>; renameByName?: Record<string, string> } | undefined
  const excluded = organize?.excludeByName ?? {}
  const renamed = organize?.renameByName ?? {}

  const refIds: string[] = []
  const rowsByKey = new Map<
    string,
    { labels: Record<string, string>; values: Record<string, number | null> }
  >()
  const labelKeys = new Set<string>()

  for (const f of frames) {
    if (!refIds.includes(f.refId)) refIds.push(f.refId)
    for (const field of f.fields) {
      if (field.type !== 'number') continue
      const labels: Record<string, string> = {}

      for (const [k, v] of Object.entries(field.labels ?? {})) {
        if (excluded[k]) continue
        labels[k] = v
        labelKeys.add(k)
      }
      const key = Object.keys(labels)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => `${k}=${labels[k]}`)
        .join(',')
      let row = rowsByKey.get(key)

      if (!row) {
        row = { labels, values: {} }
        rowsByKey.set(key, row)
      }
      row.values[f.refId] = lastNumber(field.values)
    }
  }

  const valueColumns = refIds.map((refId) =>
    valueColumnConfig(refId, refIds.length > 1, panel.fieldConfig?.overrides ?? []),
  )

  const rows = [...rowsByKey.values()]
  const sortKey = valueColumns[0]?.key

  if (sortKey) {
    rows.sort((a, b) => (b.values[sortKey] ?? -Infinity) - (a.values[sortKey] ?? -Infinity))
  }

  return {
    labelColumns: [...labelKeys].sort((a, b) => a.localeCompare(b)),
    labelTitles: renamed,
    valueColumns,
    rows,
  }
}

function valueColumnConfig(
  refId: string,
  multipleQueries: boolean,
  overrides: FieldOverride[],
): ValueColumn {
  // Grafana names merged value columns "Value #<refId>".
  const grafanaName = multipleQueries ? `Value #${refId}` : 'Value'
  const col: ValueColumn = {
    key: refId,
    title: grafanaName,
    colorBackground: false,
  }

  for (const o of overrides) {
    if (!overrideMatches(o, grafanaName)) continue
    for (const p of o.properties ?? []) {
      if (p.id === 'displayName' && typeof p.value === 'string') col.title = p.value
      if (p.id === 'unit' && typeof p.value === 'string') col.unit = p.value
      if (p.id === 'decimals' && typeof p.value === 'number') col.decimals = p.value
      if (p.id === 'thresholds' && p.value && typeof p.value === 'object') {
        const steps = (p.value as { steps?: { color?: string; value?: number | null }[] }).steps

        if (Array.isArray(steps)) {
          col.thresholds = steps.map((s) => ({
            color: s.color ?? 'green',
            value: typeof s.value === 'number' ? s.value : null,
          }))
        }
      }
      if (p.id === 'custom.cellOptions' && p.value && typeof p.value === 'object') {
        if ((p.value as { type?: string }).type === 'color-background') {
          col.colorBackground = true
        }
      }
    }
  }

  return col
}

function overrideMatches(o: FieldOverride, fieldName: string): boolean {
  const id = o.matcher?.id
  const opts = o.matcher?.options

  if (id === 'byName') return opts === fieldName
  if (id === 'byRegexp' && typeof opts === 'string') {
    try {
      return new RegExp(opts).test(fieldName)
    } catch {
      return false
    }
  }

  return false
}

function lastNumber(values: unknown[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]

    if (v == null) continue
    const n = Number(v)

    if (Number.isFinite(n)) return n
  }

  return null
}

export function thresholdColor(
  v: number | null,
  steps?: { color: string; value: number | null }[],
): string | null {
  if (v == null || !steps || steps.length === 0) return null
  const palette: Record<string, string> = {
    green: '#73bf69',
    yellow: '#f2cc0c',
    orange: '#ff9830',
    red: '#fa6e6e',
    blue: '#5794f2',
    purple: '#a78bfa',
  }
  let color: string | null = null

  for (const s of steps) {
    if (s.value == null || v >= s.value) color = palette[s.color] ?? s.color
  }

  return color
}
