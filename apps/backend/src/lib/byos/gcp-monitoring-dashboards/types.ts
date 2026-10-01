export type RawAggregation = {
  alignmentPeriod?: string
  perSeriesAligner?: string
  crossSeriesReducer?: string
  groupByFields?: string[]
}

export type RawTimeSeriesFilter = {
  filter?: string
  aggregation?: RawAggregation
  secondaryAggregation?: RawAggregation
  pickTimeSeriesFilter?: {
    rankingMethod?: string
    numTimeSeries?: number
    direction?: string
  }
}

export type RawTimeSeriesQuery = {
  unitOverride?: string
  outputFullDuration?: boolean
  timeSeriesFilter?: RawTimeSeriesFilter
  timeSeriesFilterRatio?: unknown
  timeSeriesQueryLanguage?: string
  prometheusQuery?: string
  opsAnalyticsQuery?: unknown
  traceQuery?: unknown
}

export type RawDataSet = {
  timeSeriesQuery?: RawTimeSeriesQuery
  plotType?: string
  legendTemplate?: string
  tableTemplate?: string
  sliceNameTemplate?: string
  minAlignmentPeriod?: string
}

export type RawThreshold = {
  value?: number
  category?: string
  trigger?: string
  color?: string
  direction?: string
}

export type RawWidget = {
  id?: string
  title?: string
  xyChart?: {
    dataSets?: RawDataSet[]
    thresholds?: RawThreshold[]
  }
  scorecard?: {
    timeSeriesQuery?: RawTimeSeriesQuery
    thresholds?: RawThreshold[]
    gaugeView?: { lowerBound?: number; upperBound?: number }
    sparkChartView?: { sparkChartType?: string; minAlignmentPeriod?: string }
    blankView?: Record<string, never>
  }
  text?: { content?: string; format?: string }
  timeSeriesTable?: {
    dataSets?: RawDataSet[]
    metricVisualization?: string
  }
  collapsibleGroup?: { collapsed?: boolean }
  pieChart?: {
    dataSets?: RawDataSet[]
    chartType?: string
    showLabels?: boolean
  }
  filterControl?: { templateVariable?: string }
  [key: string]: unknown
}

export type RawDashboardFilter = {
  labelKey?: string
  templateVariable?: string
  valueType?: string
  filterType?: string
  stringValue?: string
  stringArrayValue?: { values?: string[] }
  stringArray?: { values?: string[] }
  timeSeriesQuery?: RawTimeSeriesQuery
}

export type RawDashboard = {
  name?: string
  displayName?: string
  etag?: string
  labels?: Record<string, string>
  dashboardFilters?: RawDashboardFilter[]
  gridLayout?: { columns?: string; widgets?: RawWidget[] }
  mosaicLayout?: {
    columns?: number
    tiles?: {
      xPos?: number
      yPos?: number
      width?: number
      height?: number
      widget?: RawWidget
    }[]
  }
  rowLayout?: {
    rows?: { weight?: string; widgets?: RawWidget[] }[]
  }
  columnLayout?: {
    columns?: { weight?: string; widgets?: RawWidget[] }[]
  }
}

export type GcpMonitoringDashboardSummary = {
  id: string
  name: string
  displayName: string
  labels: Record<string, string>
  consoleUrl: string
}

export type GcpMonitoringDashboardFilter = {
  id: string
  label: string
  labelKey: string | null
  templateVariable: string | null
  valueType: string
  filterType: string
  defaultValue: string
  options: string[]
}

export type GcpMonitoringDashboardQuery = {
  index: number
  sourceType:
    | 'timeSeriesFilter'
    | 'timeSeriesFilterRatio'
    | 'mql'
    | 'promql'
    | 'opsAnalytics'
    | 'trace'
    | 'unknown'
  supported: boolean
  legendTemplate: string | null
  minAlignmentPeriod: string | null
  plotType: string | null
  unit: string | null
}

export type GcpMonitoringDashboardWidget = {
  ref: string
  id: string
  title: string
  kind: 'xy' | 'scorecard' | 'table' | 'text' | 'pie' | 'group' | 'filter-control' | 'unsupported'
  unsupportedType: string | null
  layout: { x: number; y: number; w: number; h: number }
  groupRef: string | null
  queries: GcpMonitoringDashboardQuery[]
  text: { content: string; format: string } | null
  gauge: { lowerBound: number; upperBound: number } | null
  thresholds: { value: number; category: string; trigger: string; color: string | null }[]
  collapsed: boolean
  chartType: string | null
  showLabels: boolean
}

export type GcpMonitoringDashboard = {
  id: string
  name: string
  displayName: string
  labels: Record<string, string>
  consoleUrl: string
  columns: number
  rowHeight: number
  filters: GcpMonitoringDashboardFilter[]
  widgets: GcpMonitoringDashboardWidget[]
}

export type GcpMonitoringDashboardSeries = {
  name: string
  labels: Record<string, string>
  resourceType: string
  metricType: string
  points: [number, number | null][]
}

export type GcpMonitoringDashboardQueryResult = {
  series: GcpMonitoringDashboardSeries[]
  truncated: boolean
  unit: string | null
  sourceType: GcpMonitoringDashboardQuery['sourceType']
}

export type GcpMonitoringDashboardWidgetQueryInput = {
  widgetRef: string
  datasetIndex: number
  startMs: number
  endMs: number
  filters: Record<string, string>
}

export type PlacedWidget = {
  ref: string
  widget: RawWidget
  layout: { x: number; y: number; w: number; h: number }
  groupRef?: string | null
}

export type WidgetQueryEntry = {
  query: RawTimeSeriesQuery
  legendTemplate?: string
  minAlignmentPeriod?: string
  plotType?: string
}
