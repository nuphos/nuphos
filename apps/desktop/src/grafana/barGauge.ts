// Pure model for the Grafana "bargauge" panel: reduceOptions gives one value
// per series, the field's min/max gives the track each bar fills, and the
// thresholds give its colour. Rendering lives in components/BarGaugePanel.tsx.

import { formatValue } from './format.ts'
import { reduceSeries } from './reduceSeries.ts'
import { thresholdColor } from './table.ts'

import type { DataFrame, Panel } from './types'

export type BarGaugeBar = {
  label: string
  value: number
  /** 0…1 of the track, clamped — a value past max fills it, never overflows. */
  fraction: number
  color: string
  text: string
}

const BASE_COLOR = '#73bf69'

function thresholdSteps(panel: Panel) {
  return (panel.fieldConfig?.defaults?.thresholds?.steps ?? []).map((step) => ({
    color: step.color ?? 'green',
    value: typeof step.value === 'number' ? step.value : null,
  }))
}

/**
 * Grafana auto-scales an unset min/max to the data, with zero as the floor;
 * a degenerate range (every value equal, or max ≤ min) still needs a width.
 */
export function barGaugeScale(panel: Panel, values: number[]): { min: number; max: number } {
  const defaults = panel.fieldConfig?.defaults
  const min = defaults?.min ?? Math.min(0, ...values)
  const max = defaults?.max ?? Math.max(...values, min + 1)

  return { min, max: max > min ? max : min + 1 }
}

export function barGaugeVertical(panel: Panel): boolean {
  return panel.options?.orientation === 'vertical'
}

export function buildBarGauge(frames: DataFrame[], panel: Panel, unit?: string): BarGaugeBar[] {
  const values = reduceSeries(frames, panel)
  const scale = barGaugeScale(
    panel,
    values.map((item) => item.value),
  )
  const steps = thresholdSteps(panel)

  return values.map((item) => ({
    label: item.label,
    value: item.value,
    fraction: Math.min(1, Math.max(0, (item.value - scale.min) / (scale.max - scale.min))),
    color: thresholdColor(item.value, steps) ?? BASE_COLOR,
    text: formatValue(item.value, unit),
  }))
}
