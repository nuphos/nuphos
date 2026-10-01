import type { Series } from './types'
import type { TimeSeriesRenderPoint } from '../../timeSeriesDisplay'

export function bounds(series: (Series & { renderPoints: TimeSeriesRenderPoint[] })[]) {
  let tMin = Infinity
  let tMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity

  for (const s of series) {
    for (const point of s.renderPoints) {
      if (point.time < tMin) tMin = point.time
      if (point.time > tMax) tMax = point.time
      if (point.base == null || point.top == null) continue
      if (point.base < vMin) vMin = point.base
      if (point.base > vMax) vMax = point.base
      if (point.top < vMin) vMin = point.top
      if (point.top > vMax) vMax = point.top
    }
  }
  if (tMin === Infinity) {
    tMin = 0
    tMax = 0
  }
  if (vMin === Infinity) {
    vMin = 0
    vMax = 1
  }
  if (vMin === vMax) {
    vMin = vMin - 1
    vMax = vMax + 1
  }
  if (vMin > 0 && vMin < (vMax - vMin) * 0.2) vMin = 0

  return { tMin, tMax, vMin, vMax }
}

export function buildLinePath(
  points: TimeSeriesRenderPoint[],
  xScale: (t: number) => number,
  yScale: (v: number) => number,
): string {
  let d = ''
  let pen = false

  for (const point of points) {
    if (point.top == null) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${xScale(point.time).toFixed(1)},${yScale(point.top).toFixed(1)}`
    pen = true
  }

  return d
}

export function buildAreaPath(
  points: TimeSeriesRenderPoint[],
  xScale: (t: number) => number,
  yScale: (v: number) => number,
): string {
  const paths: string[] = []
  let segment: TimeSeriesRenderPoint[] = []
  const flush = () => {
    if (segment.length === 0) return
    const top = segment
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${xScale(point.time).toFixed(1)},${yScale(point.top!).toFixed(1)}`,
      )
      .join('')
    const base = [...segment]
      .reverse()
      .map((point) => `L${xScale(point.time).toFixed(1)},${yScale(point.base!).toFixed(1)}`)
      .join('')

    paths.push(`${top}${base}Z`)
    segment = []
  }

  for (const point of points) {
    if (point.base == null || point.top == null) {
      flush()
    } else {
      segment.push(point)
    }
  }
  flush()

  return paths.join('')
}

export function timeBarWidth(
  series: (Series & { renderPoints: TimeSeriesRenderPoint[] })[],
  xScale: (t: number) => number,
  plotWidth: number,
): number {
  const timestamps = Array.from(
    new Set(
      series
        .filter((item) => item.style.drawStyle === 'bar')
        .flatMap((item) => item.renderPoints.map((point) => point.time)),
    ),
  ).sort((a, b) => a - b)
  let spacing = Infinity

  for (let i = 1; i < timestamps.length; i++) {
    spacing = Math.min(spacing, xScale(timestamps[i]) - xScale(timestamps[i - 1]))
  }
  if (!Number.isFinite(spacing)) spacing = plotWidth / 12

  return Math.max(2, Math.min(28, spacing * 0.72))
}

export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min

  if (span <= 0 || count <= 0) return [min]
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  let step: number

  if (norm < 1.5) step = mag
  else if (norm < 3) step = 2 * mag
  else if (norm < 7) step = 5 * mag
  else step = 10 * mag
  const start = Math.ceil(min / step) * step
  const out: number[] = []

  for (let v = start; v <= max + step / 2; v += step) out.push(v)

  return out
}
