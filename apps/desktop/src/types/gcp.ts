export type GcpMetricDescriptor = {
  type: string
  displayName: string
  kind: string
  valueType: string
  unit: string
  resourceTypes: string[]
}

export type GcpMetricSeries = {
  labels: Record<string, string>
  resourceType: string
  points: [number, number | null][]
}

export type GcpMetricTimeSeriesResult = {
  series: GcpMetricSeries[]
  truncated: boolean
}

export type GcpMetricTimeSeriesQuery = {
  metricType: string
  startMs: number
  endMs: number
  alignmentSec: number
  aligner: string
  reducer?: string
  groupBy?: string
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

export type GcpMonitoringDashboardWidgetQuery = {
  datasetIndex: number
  startMs: number
  endMs: number
  filters: Record<string, string>
}

export type GcpCloudRunService = {
  name: string
  region: string
  status: string
  url: string | null
  serviceAccountEmail: string | null
  ingress: string | null
  latestReadyRevision: string | null
  latestCreatedRevision: string | null
  creator: string | null
  traffic: { percent: number; revision: string | null; tag: string | null; type: string | null }[]
  conditions: { type: string; state: string; message: string | null }[]
  createdAt: string | null
  updatedAt: string | null
}

export type GcpCloudRunRevision = {
  name: string
  service: string
  region: string
  image: string | null
  cpu: string | null
  memory: string | null
  maxInstances: number | null
  minInstances: number | null
  serviceAccountEmail: string | null
  conditions: { type: string; state: string; message: string | null }[]
  createdAt: string | null
}
