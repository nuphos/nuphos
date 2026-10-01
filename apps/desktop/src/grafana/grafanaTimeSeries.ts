import type { TimeSeriesStyle } from './timeSeriesDisplay.ts'
import type { Panel } from './types.ts'

export type GrafanaTimeSeriesConfig = {
  style: TimeSeriesStyle
  min?: number
  max?: number
  centeredZero: boolean
  showLegend: boolean
}

// Translate Grafana's saved time-series presentation into the smaller set of
// chart primitives our renderer supports. A line with fill becomes an area;
// it still draws the line on top, matching Grafana's visual result.
export function grafanaTimeSeriesConfig(panel: Panel): GrafanaTimeSeriesConfig {
  const defaults = panel.fieldConfig?.defaults
  const custom = defaults?.custom
  const fillOpacity = clampOpacity(custom?.fillOpacity)
  const rawDrawStyle = custom?.drawStyle
  let drawStyle: TimeSeriesStyle['drawStyle'] = 'line'

  if (rawDrawStyle === 'bars') drawStyle = 'bar'
  else if (fillOpacity > 0) drawStyle = 'area'
  const stacking = custom?.stacking
  const legend = panel.options?.legend
  const showLegend =
    !legend || typeof legend !== 'object' || !('showLegend' in legend)
      ? true
      : (legend as { showLegend?: unknown }).showLegend !== false

  return {
    style: {
      drawStyle,
      fillOpacity,
      gradientMode: custom?.gradientMode,
      lineWidth: custom?.lineWidth,
      stack:
        stacking?.mode === 'normal' && drawStyle !== 'line' ? (stacking.group ?? 'A') : undefined,
    },
    min: defaults?.min,
    max: defaults?.max,
    centeredZero: custom?.axisCenteredZero === true,
    showLegend,
  }
}

function clampOpacity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0

  return Math.max(0, Math.min(1, value / 100))
}
