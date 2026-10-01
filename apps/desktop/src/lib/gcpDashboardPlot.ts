import type { TimeSeriesStyle } from '../grafana/timeSeriesDisplay.ts'

const GCP_STACK = 'gcp-widget'

/** Maps Cloud Monitoring XyChart plot types to Nuphos rendering semantics. */
export function gcpTimeSeriesStyle(plotType: string | null | undefined): TimeSeriesStyle {
  switch (plotType?.toUpperCase()) {
    case 'STACKED_AREA':
      return { drawStyle: 'area', stack: GCP_STACK }
    case 'STACKED_BAR':
      return { drawStyle: 'bar', stack: GCP_STACK }
    case 'LINE':
    case undefined:
    default:
      return { drawStyle: 'line' }
  }
}

export function gcpFrameTimeSeriesStyle(
  frameRef: string,
  queries: { index: number; plotType: string | null }[],
): TimeSeriesStyle {
  const datasetIndex = Number(/^q(\d+)s/.exec(frameRef)?.[1] ?? -1)

  return gcpTimeSeriesStyle(queries.find((candidate) => candidate.index === datasetIndex)?.plotType)
}
