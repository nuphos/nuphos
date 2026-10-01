import { useEffect, useMemo, useRef, useState } from 'react'

import { AppSelect } from '../../components/ui/select'
import { useReportLoading } from '../../components/useReportLoading'
import { useResetOnKey } from '../useResetOnKey'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { EXPLORER_MAX_SERIES, dimensionsLabel } from './metrics-explorer-shared'
import { MetricSeriesCard, RangeButtons } from './metrics-explorer-widgets'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { DataFrame } from '../../grafana/types'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type {
  GcpMetricDescriptor,
  GcpMetricSeries,
  GcpMetricTimeSeriesQuery,
  GcpMetricTimeSeriesResult,
} from '../../types'

// GCP Cloud Monitoring metrics explorer — the CloudWatch explorer's
// twin: service → metric, then chart every returned series through the shared
// TimeSeriesPanel. Data comes straight from the Monitoring v3 API via the
// bound connector; no Grafana involved.
const GCP_ALIGNERS = [
  { value: 'ALIGN_MEAN', label: 'Mean' },
  { value: 'ALIGN_MAX', label: 'Max' },
  { value: 'ALIGN_MIN', label: 'Min' },
  { value: 'ALIGN_SUM', label: 'Sum' },
  { value: 'ALIGN_RATE', label: 'Rate' },
  { value: 'ALIGN_PERCENTILE_95', label: 'P95' },
  { value: 'ALIGN_PERCENTILE_99', label: 'P99' },
] as const

// Coarser alignment for longer windows keeps point counts chart-friendly.
// The descriptor catalog lists every metric GCP DEFINES (~thousands), most
// without data. Preselect instance CPU — nearly every project runs VMs/GKE
// nodes — so the page opens onto a real chart instead of an empty picker.
const GCP_DEFAULT_METRIC = 'compute.googleapis.com/instance/cpu/utilization'
const GCP_DEFAULT_SERVICE = 'compute.googleapis.com'

function gcpAlignmentSec(rangeMinutes: number): number {
  if (rangeMinutes <= 180) return 60
  if (rangeMinutes <= 1440) return 300

  return 3600
}

export function GcpMetricsExplorerView({
  descriptorsLoader,
  dataLoader,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  descriptorsLoader: ResourceListLoader<GcpMetricDescriptor>
  dataLoader: (query: GcpMetricTimeSeriesQuery) => Promise<GcpMetricTimeSeriesResult>
}) {
  // The full descriptor sweep takes seconds (thousands of entries, paginated
  // server-side) — stale-while-revalidate makes revisits instant.
  const {
    items: descriptorItems,
    loading: descriptorsLoading,
    error: descriptorsError,
  } = useResourceList<GcpMetricDescriptor>(descriptorsLoader, refreshKey)
  const descriptors = descriptorsLoading && descriptorItems.length === 0 ? null : descriptorItems
  const hasDefaultMetric = useMemo(
    () => descriptors?.some((d) => d.type === GCP_DEFAULT_METRIC) ?? false,
    [descriptors],
  )
  // `service` is the metric-type domain (compute.googleapis.com, …) — GCP's
  // closest analog to a CloudWatch namespace.
  const [service, setService] = useState(hasDefaultMetric ? GCP_DEFAULT_SERVICE : '')
  const [metricType, setMetricType] = useState(hasDefaultMetric ? GCP_DEFAULT_METRIC : '')
  const [aligner, setAligner] = useState<string>('ALIGN_MEAN')
  const [rangeMinutes, setRangeMinutes] = useState(180)
  const [series, setSeries] = useState<GcpMetricSeries[] | null>(null)
  const [seriesTruncated, setSeriesTruncated] = useState(false)
  const [seriesLoading, setSeriesLoading] = useState(hasDefaultMetric)
  const [seriesError, setSeriesError] = useState<string | null>(null)
  const dataLoaderRef = useRef(dataLoader)

  useEffect(() => {
    dataLoaderRef.current = dataLoader
  })
  const requestGenRef = useRef(0)

  useReportLoading(descriptorsLoading || seriesLoading, onLoading)

  // Preselect on the one render where the catalog lands (a warm cache is
  // already covered by the state initializers above).
  useResetOnKey(descriptors ? 'ready' : 'pending', () => {
    if (!hasDefaultMetric) return
    setService(GCP_DEFAULT_SERVICE)
    setMetricType(GCP_DEFAULT_METRIC)
  })

  const services = useMemo(() => {
    const set = new Set<string>()

    for (const d of descriptors ?? []) set.add(d.type.split('/')[0] ?? d.type)

    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [descriptors])

  const serviceMetrics = useMemo(() => {
    if (!service) return []

    return (descriptors ?? [])
      .filter((d) => d.type.startsWith(`${service}/`))
      .sort((a, b) => a.type.localeCompare(b.type))
  }, [descriptors, service])

  const selectedDescriptor = useMemo(
    () => (descriptors ?? []).find((d) => d.type === metricType) ?? null,
    [descriptors, metricType],
  )

  useResetOnKey(`${metricType}|${aligner}|${String(rangeMinutes)}|${String(refreshKey)}`, () => {
    if (!metricType) {
      setSeries(null)

      return
    }
    setSeriesLoading(true)
    setSeriesError(null)
  })
  useEffect(() => {
    if (!metricType) return
    const gen = ++requestGenRef.current
    const endMs = Date.now()

    dataLoaderRef
      .current({
        metricType,
        startMs: endMs - rangeMinutes * 60_000,
        endMs,
        alignmentSec: gcpAlignmentSec(rangeMinutes),
        aligner,
      })
      .then((r) => {
        if (requestGenRef.current !== gen) return
        setSeries(r.series)
        setSeriesTruncated(r.truncated)
        setSeriesLoading(false)
      })
      .catch((e: unknown) => {
        if (requestGenRef.current !== gen) return
        setSeriesError(String(e instanceof Error ? e.message : e))
        setSeriesLoading(false)
      })
  }, [metricType, aligner, rangeMinutes, refreshKey])

  // Keeping the previous result is useful while changing the range or
  // aligner, but it is misleading after selecting a different metric.
  useResetOnKey(metricType, () => {
    setSeries(null)
    setSeriesTruncated(false)
  })

  const shownSeries = useMemo(() => (series ?? []).slice(0, EXPLORER_MAX_SERIES), [series])
  const truncatedSeries = Math.max(0, (series?.length ?? 0) - shownSeries.length)

  const frames = useMemo<DataFrame[]>(
    () =>
      shownSeries.map((s, i) => {
        const label = dimensionsLabel(s.labels)

        return {
          refId: `m${String(i)}`,
          name: label,
          fields: [
            { name: 'time', type: 'time' as const, values: s.points.map((p) => p[0]) },
            { name: label, type: 'number' as const, values: s.points.map((p) => p[1]) },
          ],
        }
      }),
    [shownSeries],
  )

  const filteredServices = applyFilter(services, filter, (s) => s)

  useEffect(() => {
    onCount(series?.length ?? filteredServices.length)
  }, [series, filteredServices.length, onCount])

  const hasData = frames.some((f) => (f.fields[0]?.values.length ?? 0) > 0)
  const metricLeaf = (type: string) => type.slice(type.indexOf('/') + 1)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zGray-800 flex items-center gap-2 text-[11.5px] flex-wrap">
        <AppSelect
          value={service}
          onValueChange={(v) => {
            setService(v)
            setMetricType('')
          }}
          placeholder={descriptorsLoading ? 'Loading services…' : 'Service'}
          disabled={!descriptors || services.length === 0}
          triggerClassName="h-7 border-zGray-800 px-2 text-[12px] min-w-[220px]"
          options={services.map((s) => ({ value: s, label: s }))}
        />
        <AppSelect
          value={metricType}
          onValueChange={setMetricType}
          placeholder="Metric"
          disabled={!service}
          triggerClassName="h-7 border-zGray-800 px-2 text-[12px] min-w-[260px]"
          options={serviceMetrics.map((d) => ({
            value: d.type,
            label: metricLeaf(d.type),
            description: d.displayName,
          }))}
        />
        <AppSelect
          value={aligner}
          onValueChange={setAligner}
          triggerClassName="h-7 border-zGray-800 px-2 text-[12px] w-[100px]"
          options={GCP_ALIGNERS.map((a) => ({ value: a.value, label: a.label }))}
        />
        <RangeButtons rangeMinutes={rangeMinutes} setRangeMinutes={setRangeMinutes} />
      </div>

      {descriptorsError ? (
        <ErrorBlock message={descriptorsError} />
      ) : seriesError ? (
        <ErrorBlock message={seriesError} />
      ) : !metricType ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-tertiary px-8 text-center">
          {descriptorsLoading
            ? 'Listing metric descriptors…'
            : descriptors && services.length === 0
              ? 'No Cloud Monitoring metrics found in this project.'
              : 'Pick a service and metric to chart every series it emits.'}
        </div>
      ) : seriesLoading && !series ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-tertiary">
          Loading time series…
        </div>
      ) : (
        <MetricSeriesCard
          title={selectedDescriptor?.displayName ?? metricLeaf(metricType)}
          subtitle={
            <>
              {GCP_ALIGNERS.find((a) => a.value === aligner)?.label ?? aligner} ·{' '}
              {series?.length ?? 0} series
              {truncatedSeries > 0
                ? ` (showing first ${String(EXPLORER_MAX_SERIES)}, ${String(truncatedSeries)} more hidden)`
                : ''}
              {seriesTruncated ? ' · partial result (pagination limit reached)' : ''}
              {selectedDescriptor?.unit ? ` · unit: ${selectedDescriptor.unit}` : ''}
            </>
          }
          frames={frames}
          unit={selectedDescriptor?.unit}
          hasData={hasData}
        />
      )}
    </div>
  )
}
