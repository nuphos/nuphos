export type TimeSeriesDrawStyle = 'line' | 'area' | 'bar'

export type TimeSeriesStyle = {
  drawStyle: TimeSeriesDrawStyle
  stack?: string
  fillOpacity?: number
  gradientMode?: string
  lineWidth?: number
}

export type TimeSeriesPoint = [number, number | null]

export type TimeSeriesRenderPoint = {
  time: number
  value: number | null
  base: number | null
  top: number | null
}

export type StackableTimeSeries = {
  points: TimeSeriesPoint[]
  style: TimeSeriesStyle
}

export const DEFAULT_TIME_SERIES_STYLE: TimeSeriesStyle = { drawStyle: 'line' }

// An unstacked area fills toward the bottom of the visible plot. Stacked
// areas keep the computed stack baseline instead.
export function areaPointsForAxis(
  points: TimeSeriesRenderPoint[],
  axisMin: number,
  stacked: boolean,
): TimeSeriesRenderPoint[] {
  if (stacked) return points

  return points.map((point) => ({
    ...point,
    base: point.top == null ? null : axisMin,
  }))
}

/**
 * Computes the visual base/top for area and bar series while retaining the
 * original value for tooltips. Positive and negative values use independent
 * stacks, matching the way charting systems keep a zero baseline readable.
 */
export function layoutTimeSeries<T extends StackableTimeSeries>(
  series: T[],
): (T & { renderPoints: TimeSeriesRenderPoint[] })[] {
  const positive = new Map<string, Map<number, number>>()
  const negative = new Map<string, Map<number, number>>()

  return series.map((item) => {
    const stackKey =
      item.style.drawStyle !== 'line' && item.style.stack
        ? `${item.style.drawStyle}:${item.style.stack}`
        : null
    const renderPoints = item.points.map(([time, value]): TimeSeriesRenderPoint => {
      if (value == null) return { time, value, base: null, top: null }

      if (item.style.drawStyle === 'line') {
        return { time, value, base: value, top: value }
      }

      if (!stackKey) {
        return { time, value, base: 0, top: value }
      }

      const stacks = value >= 0 ? positive : negative
      let totals = stacks.get(stackKey)

      if (!totals) {
        totals = new Map<number, number>()
        stacks.set(stackKey, totals)
      }
      const base = totals.get(time) ?? 0
      const top = base + value

      totals.set(time, top)

      return { time, value, base, top }
    })

    return { ...item, renderPoints }
  })
}
