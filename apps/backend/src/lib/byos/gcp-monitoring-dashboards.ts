// GCP Cloud Monitoring custom dashboards — read-only dashboard discovery,
// normalization, and execution of queries saved on dashboard widgets.
//
// The desktop never sends a Monitoring filter or query language expression.
// It identifies a dashboard/widget/dataset, and this module reloads the
// provider-owned dashboard definition before executing that stored query.

export { BoundedTtlCache } from './gcp-monitoring-dashboards/cache'
export { listGcpMonitoringDashboards } from './gcp-monitoring-dashboards/client'
export { applyDashboardFilterSelections } from './gcp-monitoring-dashboards/filters'
export {
  getGcpMonitoringDashboard,
  normalizeGcpMonitoringDashboard,
} from './gcp-monitoring-dashboards/normalize'
export { queryGcpMonitoringDashboardWidget } from './gcp-monitoring-dashboards/query'
export { monitoringSeriesKey, rankSeries } from './gcp-monitoring-dashboards/series'
export type {
  GcpMonitoringDashboard,
  GcpMonitoringDashboardFilter,
  GcpMonitoringDashboardQuery,
  GcpMonitoringDashboardQueryResult,
  GcpMonitoringDashboardSeries,
  GcpMonitoringDashboardSummary,
  GcpMonitoringDashboardWidget,
  GcpMonitoringDashboardWidgetQueryInput,
} from './gcp-monitoring-dashboards/types'
