// Pure model for the Grafana "piechart" panel: reduceOptions gives one value
// per series, and the slice geometry follows from their share of the total.
// Rendering lives in components/PieChartPanel.tsx.

import { colorFor } from './format.ts'
import { reduceSeries } from './reduceSeries.ts'

import type { SeriesValue } from './reduceSeries.ts'
import type { DataFrame, Panel } from './types'

export type PieSlice = SeriesValue & {
  color: string
  fraction: number
  fromDeg: number
  toDeg: number
}

export type PieOptions = {
  donut: boolean
  legend: 'right' | 'bottom' | 'hidden'
  labels: { name: boolean; value: boolean; percent: boolean }
}

export type PieRing = { cx: number; cy: number; outer: number; inner: number }

function legendPlacement(legend: { showLegend?: unknown; placement?: unknown } | undefined) {
  if (legend?.showLegend === false) return 'hidden' as const

  return legend?.placement === 'bottom' ? ('bottom' as const) : ('right' as const)
}

export function pieOptions(panel: Panel): PieOptions {
  const options = panel.options ?? {}
  const legend = options.legend as { showLegend?: unknown; placement?: unknown } | undefined
  const displayLabels = Array.isArray(options.displayLabels) ? options.displayLabels : []

  return {
    donut: options.pieType === 'donut',
    legend: legendPlacement(legend),
    labels: {
      name: displayLabels.includes('name'),
      value: displayLabels.includes('value'),
      percent: displayLabels.includes('percent'),
    },
  }
}

/** Slices in query order, starting at 12 o'clock and running clockwise. */
export function buildPieSlices(frames: DataFrame[], panel: Panel): PieSlice[] {
  // Grafana's pie ignores non-positive values: they have no arc to occupy.
  const values = reduceSeries(frames, panel).filter((item) => item.value > 0)
  const total = values.reduce((sum, item) => sum + item.value, 0)

  if (total <= 0) return []
  let fromDeg = -90

  return values.map((item, index) => {
    const fraction = item.value / total
    const slice = {
      ...item,
      color: colorFor(index),
      fraction,
      fromDeg,
      toDeg: fromDeg + fraction * 360,
    }

    fromDeg = slice.toDeg

    return slice
  })
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180

  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function fmt(value: number): string {
  return value.toFixed(2)
}

export function pieLabelAnchor(ring: PieRing, slice: PieSlice): [number, number] {
  const mid = (slice.fromDeg + slice.toDeg) / 2

  return polar(ring.cx, ring.cy, ring.inner + (ring.outer - ring.inner) * 0.62, mid)
}

function point(ring: PieRing, r: number, deg: number): string {
  const [x, y] = polar(ring.cx, ring.cy, r, deg)

  return `${fmt(x)},${fmt(y)}`
}

/** A full-circle slice can't be drawn as one arc, so it becomes two halves. */
export function pieSlicePath(ring: PieRing, fromDeg: number, toDeg: number): string {
  if (toDeg - fromDeg >= 359.999) {
    const half = fromDeg + 180

    return `${pieSlicePath(ring, fromDeg, half)} ${pieSlicePath(ring, half, toDeg - 0.001)}`
  }
  const { cx, cy, outer, inner } = ring
  const large = toDeg - fromDeg > 180 ? '1' : '0'
  const outerArc = `A${fmt(outer)},${fmt(outer)} 0 ${large} 1 ${point(ring, outer, toDeg)}`

  if (inner <= 0) {
    return `M${fmt(cx)},${fmt(cy)} L${point(ring, outer, fromDeg)} ${outerArc} Z`
  }

  return [
    `M${point(ring, outer, fromDeg)}`,
    outerArc,
    `L${point(ring, inner, toDeg)}`,
    `A${fmt(inner)},${fmt(inner)} 0 ${large} 0 ${point(ring, inner, fromDeg)}`,
    'Z',
  ].join(' ')
}
