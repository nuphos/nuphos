import { appendQuery, call, withGcpServiceAccount } from './client'
// Cloud Monitoring metrics explorer. Shapes mirror the backend's
// gcp-monitoring lib verbatim.
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

export async function listGcpMetricDescriptors(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<GcpMetricDescriptor[]> {
  const data = await call<{ descriptors: GcpMetricDescriptor[] }>(
    'GET',
    withGcpServiceAccount(
      `/teams/${teamId}/gcp-projects/${projectId}/monitoring/metric-descriptors`,
      serviceAccountId,
    ),
    undefined,
    // Keep the client budget above the backend's paginated GCP request budget.
    { timeoutMs: 210_000 },
  )

  return data.descriptors ?? []
}

export async function queryGcpMetricTimeSeries(
  teamId: string,
  projectId: string,
  query: GcpMetricTimeSeriesQuery,
  serviceAccountId?: string,
): Promise<GcpMetricTimeSeriesResult> {
  const data = await call<GcpMetricTimeSeriesResult>(
    'GET',
    appendQuery(`/teams/${teamId}/gcp-projects/${projectId}/monitoring/timeseries`, {
      serviceAccountId,
      metricType: query.metricType,
      startMs: query.startMs,
      endMs: query.endMs,
      alignmentSec: query.alignmentSec,
      aligner: query.aligner,
      reducer: query.reducer,
      groupBy: query.groupBy,
    }),
    undefined,
    // The backend may fetch up to four sequential GCP pages at 45s each.
    { timeoutMs: 210_000 },
  )

  return { series: data.series ?? [], truncated: data.truncated }
}

export async function listGcpMonitoringDashboards(
  teamId: string,
  projectId: string,
  serviceAccountId?: string,
): Promise<GcpMonitoringDashboardSummary[]> {
  const data = await call<{ dashboards: GcpMonitoringDashboardSummary[] }>(
    'GET',
    withGcpServiceAccount(
      `/teams/${teamId}/gcp-projects/${projectId}/monitoring/dashboards`,
      serviceAccountId,
    ),
  )

  return data.dashboards ?? []
}

export async function getGcpMonitoringDashboard(
  teamId: string,
  projectId: string,
  dashboardId: string,
  serviceAccountId?: string,
): Promise<GcpMonitoringDashboard> {
  return call<GcpMonitoringDashboard>(
    'GET',
    withGcpServiceAccount(
      `/teams/${teamId}/gcp-projects/${projectId}/monitoring/dashboards/${encodeURIComponent(dashboardId)}`,
      serviceAccountId,
    ),
  )
}

export async function queryGcpMonitoringDashboardWidget(
  teamId: string,
  projectId: string,
  dashboardId: string,
  widgetRef: string,
  query: GcpMonitoringDashboardWidgetQuery,
  serviceAccountId?: string,
): Promise<GcpMonitoringDashboardQueryResult> {
  return call<GcpMonitoringDashboardQueryResult>(
    'POST',
    withGcpServiceAccount(
      `/teams/${teamId}/gcp-projects/${projectId}/monitoring/dashboards/${encodeURIComponent(dashboardId)}/widgets/${encodeURIComponent(widgetRef)}/query`,
      serviceAccountId,
    ),
    query,
    { timeoutMs: 210_000 },
  )
}
