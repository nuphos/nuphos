import type { TimeSeriesStyle } from '../../timeSeriesDisplay'

export type Series = {
  id: string
  label: string
  color: string
  points: [number, number | null][]
  style: TimeSeriesStyle
}
