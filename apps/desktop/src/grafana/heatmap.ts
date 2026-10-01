// Pure model for the Grafana "heatmap" panel: Prometheus histogram series
// arrive as cumulative `le` buckets (format: "heatmap" targets); cells hold
// the per-bucket rate after de-accumulating. Rendering lives in
// components/HeatmapPanel.tsx.

import type { DataFrame } from './types'

export type HeatmapModel = {
  times: number[]
  buckets: number[] // upper bounds, ascending; Infinity for +Inf
  // cells[bucketIdx][timeIdx] = per-bucket (non-cumulative) rate
  cells: number[][]
  max: number
}

export function buildHeatmap(frames: DataFrame[]): HeatmapModel | null {
  type Series = { le: number; byTime: Map<number, number> }
  const series: Series[] = []
  const timeSet = new Set<number>()

  for (const f of frames) {
    const timeField = f.fields.find((x) => x.type === 'time')

    if (!timeField) continue
    for (const field of f.fields) {
      if (field.type !== 'number') continue
      const leRaw = field.labels?.le ?? field.name
      const le = leRaw === '+Inf' ? Infinity : Number(leRaw)

      if (!Number.isFinite(le) && le !== Infinity) continue
      const byTime = new Map<number, number>()
      const len = Math.min(timeField.values.length, field.values.length)

      for (let i = 0; i < len; i++) {
        const t = Number(timeField.values[i])
        const v = Number(field.values[i])

        if (!Number.isFinite(t) || !Number.isFinite(v)) continue
        byTime.set(t, v)
        timeSet.add(t)
      }
      series.push({ le, byTime })
    }
  }
  if (series.length === 0) return null

  series.sort((a, b) => a.le - b.le)
  const times = [...timeSet].sort((a, b) => a - b)

  const cells: number[][] = []
  let max = 0

  for (let b = 0; b < series.length; b++) {
    const row: number[] = []

    for (const t of times) {
      const cur = series[b].byTime.get(t) ?? 0
      const prev = b > 0 ? (series[b - 1].byTime.get(t) ?? 0) : 0
      const v = Math.max(0, cur - prev)

      row.push(v)
      if (v > max) max = v
    }
    cells.push(row)
  }

  return { times, buckets: series.map((s) => s.le), cells, max }
}
