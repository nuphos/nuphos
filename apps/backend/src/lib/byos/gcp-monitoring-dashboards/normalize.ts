import { dashboardConsoleUrl, dashboardIdFromName, getRawDashboard } from './client'
import { placeWidgets } from './layout'

import type {
  GcpMonitoringDashboard,
  GcpMonitoringDashboardFilter,
  GcpMonitoringDashboardQuery,
  GcpMonitoringDashboardWidget,
  PlacedWidget,
  RawDashboard,
  RawDashboardFilter,
  RawDataSet,
  RawThreshold,
  RawTimeSeriesQuery,
  RawWidget,
  WidgetQueryEntry,
} from './types'
import type { GcpHandle } from '@/lib/byos/gcp'

export function querySourceType(
  query: RawTimeSeriesQuery | undefined,
): GcpMonitoringDashboardQuery['sourceType'] {
  if (!query) return 'unknown'
  if (query.timeSeriesFilter) return 'timeSeriesFilter'
  if (query.timeSeriesFilterRatio) return 'timeSeriesFilterRatio'
  if (query.timeSeriesQueryLanguage) return 'mql'
  if (query.prometheusQuery) return 'promql'
  if (query.opsAnalyticsQuery) return 'opsAnalytics'
  if (query.traceQuery) return 'trace'

  return 'unknown'
}

export function widgetQueries(widget: RawWidget): WidgetQueryEntry[] {
  if (widget.xyChart) {
    return (widget.xyChart.dataSets ?? [])
      .filter(
        (dataset): dataset is RawDataSet & { timeSeriesQuery: RawTimeSeriesQuery } =>
          !!dataset.timeSeriesQuery,
      )
      .map((dataset) => ({
        query: dataset.timeSeriesQuery,
        legendTemplate: dataset.legendTemplate,
        minAlignmentPeriod: dataset.minAlignmentPeriod,
        plotType: dataset.plotType,
      }))
  }
  if (widget.scorecard?.timeSeriesQuery) {
    return [
      {
        query: widget.scorecard.timeSeriesQuery,
        minAlignmentPeriod: widget.scorecard.sparkChartView?.minAlignmentPeriod,
        plotType: widget.scorecard.sparkChartView?.sparkChartType,
      },
    ]
  }
  if (widget.timeSeriesTable) {
    return (widget.timeSeriesTable.dataSets ?? [])
      .filter(
        (dataset): dataset is RawDataSet & { timeSeriesQuery: RawTimeSeriesQuery } =>
          !!dataset.timeSeriesQuery,
      )
      .map((dataset) => ({
        query: dataset.timeSeriesQuery,
        legendTemplate: dataset.tableTemplate,
        minAlignmentPeriod: dataset.minAlignmentPeriod,
      }))
  }
  if (widget.pieChart) {
    return (widget.pieChart.dataSets ?? [])
      .filter(
        (dataset): dataset is RawDataSet & { timeSeriesQuery: RawTimeSeriesQuery } =>
          !!dataset.timeSeriesQuery,
      )
      .map((dataset) => ({
        query: dataset.timeSeriesQuery,
        legendTemplate: dataset.sliceNameTemplate,
        minAlignmentPeriod: dataset.minAlignmentPeriod,
      }))
  }

  return []
}

function unsupportedWidgetType(widget: RawWidget): string {
  const knownMetadata = new Set(['id', 'title', 'visibilityCondition'])
  const key = Object.keys(widget).find((candidate) => !knownMetadata.has(candidate))

  return key ?? 'unknown'
}

function normalizeThresholds(widget: RawWidget): GcpMonitoringDashboardWidget['thresholds'] {
  const raw = widget.xyChart?.thresholds ?? widget.scorecard?.thresholds ?? []

  return raw
    .filter((threshold): threshold is RawThreshold & { value: number } =>
      Number.isFinite(threshold.value),
    )
    .map((threshold) => ({
      value: threshold.value,
      category: threshold.category ?? 'CATEGORY_UNSPECIFIED',
      trigger: threshold.trigger ?? threshold.direction ?? 'TRIGGER_UNSPECIFIED',
      color: threshold.color ?? null,
    }))
}

function normalizeWidget(item: PlacedWidget): GcpMonitoringDashboardWidget {
  const { widget } = item
  let kind: GcpMonitoringDashboardWidget['kind'] = 'unsupported'

  if (widget.xyChart) kind = 'xy'
  else if (widget.scorecard) kind = 'scorecard'
  else if (widget.timeSeriesTable) kind = 'table'
  else if (widget.text) kind = 'text'
  else if (widget.pieChart) kind = 'pie'
  else if (widget.collapsibleGroup) kind = 'group'
  else if (widget.filterControl) kind = 'filter-control'

  const rawQueries = widgetQueries(widget)

  return {
    ref: item.ref,
    id: widget.id?.trim() || item.ref,
    title: widget.title?.trim() || (kind === 'group' ? 'Group' : 'Untitled'),
    kind,
    unsupportedType: kind === 'unsupported' ? unsupportedWidgetType(widget) : null,
    layout: item.layout,
    groupRef: item.groupRef ?? null,
    queries: rawQueries.map((entry, index) => {
      const sourceType = querySourceType(entry.query)

      return {
        index,
        sourceType,
        supported: sourceType === 'timeSeriesFilter',
        legendTemplate: entry.legendTemplate ?? null,
        minAlignmentPeriod: entry.minAlignmentPeriod ?? null,
        plotType: entry.plotType ?? null,
        unit: entry.query.unitOverride ?? null,
      }
    }),
    text: widget.text
      ? { content: widget.text.content ?? '', format: widget.text.format ?? 'MARKDOWN' }
      : null,
    gauge: widget.scorecard?.gaugeView
      ? {
          lowerBound: Number.isFinite(widget.scorecard.gaugeView.lowerBound)
            ? widget.scorecard.gaugeView.lowerBound!
            : 0,
          upperBound: Number.isFinite(widget.scorecard.gaugeView.upperBound)
            ? widget.scorecard.gaugeView.upperBound!
            : 100,
        }
      : null,
    thresholds: normalizeThresholds(widget),
    collapsed: widget.collapsibleGroup?.collapsed === true,
    chartType: widget.pieChart?.chartType ?? null,
    showLabels: widget.pieChart?.showLabels === true,
  }
}

export function filterId(filter: RawDashboardFilter, index: number): string {
  return filter.templateVariable?.trim() || filter.labelKey?.trim() || `filter-${String(index)}`
}

function normalizeFilters(raw: RawDashboard): GcpMonitoringDashboardFilter[] {
  return (raw.dashboardFilters ?? []).map((filter, index) => {
    const options = Array.from(new Set((filter.stringArray?.values ?? []).map(String)))
    const defaults = filter.stringArrayValue?.values ?? []
    const defaultValue = filter.stringValue ?? defaults[0] ?? options[0] ?? ''
    const id = filterId(filter, index)

    return {
      id,
      label:
        filter.templateVariable?.trim() || filter.labelKey?.trim() || `Filter ${String(index + 1)}`,
      labelKey: filter.labelKey?.trim() || null,
      templateVariable: filter.templateVariable?.trim() || null,
      valueType: filter.valueType ?? (filter.stringArrayValue ? 'STRING_ARRAY' : 'STRING'),
      filterType: filter.filterType ?? 'FILTER_TYPE_UNSPECIFIED',
      defaultValue,
      options,
    }
  })
}

export function normalizeGcpMonitoringDashboard(
  raw: RawDashboard,
  projectId: string,
): GcpMonitoringDashboard {
  const id = dashboardIdFromName(raw.name)
  const { columns, placed } = placeWidgets(raw)

  return {
    id,
    name: raw.name ?? `projects/${projectId}/dashboards/${id}`,
    displayName: raw.displayName?.trim() || id || 'Untitled dashboard',
    labels: raw.labels ?? {},
    consoleUrl: dashboardConsoleUrl(projectId, id),
    columns,
    rowHeight: raw.mosaicLayout ? 18 : 32,
    filters: normalizeFilters(raw),
    widgets: placed.map(normalizeWidget),
  }
}

export async function getGcpMonitoringDashboard(
  handle: GcpHandle,
  dashboardId: string,
): Promise<GcpMonitoringDashboard> {
  return normalizeGcpMonitoringDashboard(
    await getRawDashboard(handle, dashboardId),
    handle.projectId,
  )
}
