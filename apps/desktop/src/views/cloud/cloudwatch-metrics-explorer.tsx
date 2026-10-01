import { useEffect, useMemo, useRef, useState } from 'react'

import { AppSelect } from '../../components/ui/select'
import { useReportLoading } from '../../components/useReportLoading'
import { useResetOnKey } from '../useResetOnKey'

import {
  cloudWatchMetricNames,
  cloudWatchNamespaces,
  cloudWatchSeriesFrames,
} from './cloudwatch-explorer-format'
import { ErrorBlock } from './ErrorBlock'
import {
  AWS_REGIONS,
  EXPLORER_MAX_SERIES,
  METRIC_STATS,
  dimensionsLabel,
} from './metrics-explorer-shared'
import { MetricSeriesCard, RangeButtons } from './metrics-explorer-widgets'
import { RegionCombobox } from './region-combobox'
import { applyFilter } from './shared'

import type { MetricStat } from './metrics-explorer-shared'
import type { CommonProps } from './shared'
import type { DataFrame } from '../../grafana/types'
import type {
  AwsCloudWatchMetric,
  AwsCloudWatchMetricData,
  AwsCloudWatchMetricListing,
  AwsCloudWatchMetricQuery,
} from '../../types'

// Lightweight CloudWatch metrics explorer: region → namespace → metric, then
// every dimension combination (capped) is charted as its own series.
export function CloudWatchMetricsExplorerView({
  metricsLoader,
  dataLoader,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  metricsLoader: (region: string, namespace?: string) => Promise<AwsCloudWatchMetricListing>
  dataLoader: (region: string, query: AwsCloudWatchMetricQuery) => Promise<AwsCloudWatchMetricData>
}) {
  const [region, setRegion] = useState('us-east-1')
  const [metrics, setMetrics] = useState<AwsCloudWatchMetric[] | null>(null)
  const [metricsTruncated, setMetricsTruncated] = useState(false)
  const [nsMetrics, setNsMetrics] = useState<AwsCloudWatchMetric[] | null>(null)
  // The mount sweep is already in flight; the render-time reset below only
  // covers later region/refresh changes.
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [namespace, setNamespace] = useState('')
  const [metricName, setMetricName] = useState('')
  const [stat, setStat] = useState<MetricStat>('Average')
  const [rangeMinutes, setRangeMinutes] = useState(180)
  const [seriesData, setSeriesData] = useState<
    | {
        label: string
        data: AwsCloudWatchMetricData
      }[]
    | null
  >(null)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [seriesError, setSeriesError] = useState<string | null>(null)
  const [truncatedSeries, setTruncatedSeries] = useState(0)
  const metricsLoaderRef = useRef(metricsLoader)
  const dataLoaderRef = useRef(dataLoader)

  useEffect(() => {
    metricsLoaderRef.current = metricsLoader
    dataLoaderRef.current = dataLoader
  })
  const requestGenRef = useRef(0)

  useReportLoading(metricsLoading || seriesLoading, onLoading)

  // One ListMetrics sweep per region; namespaces/metrics derive from it.
  useResetOnKey(`${region}|${String(refreshKey)}`, () => {
    setMetricsLoading(true)
    setMetricsError(null)
    setMetrics(null)
    setMetricsTruncated(false)
    setNamespace('')
    setMetricName('')
    setSeriesData(null)
  })
  useEffect(() => {
    let cancelled = false

    metricsLoaderRef
      .current(region)
      .then((r) => {
        if (cancelled) return
        setMetrics(r.metrics)
        setMetricsTruncated(r.truncated)
        setMetricsLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setMetricsError(String(e instanceof Error ? e.message : e))
        setMetricsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [region, refreshKey])

  // The region-wide sweep can truncate in metric-heavy regions; re-query
  // scoped to the chosen namespace so its metric names and dimension
  // combinations are complete regardless.
  useResetOnKey(`${region}|${namespace}|${String(refreshKey)}`, () => setNsMetrics(null))
  useEffect(() => {
    if (!namespace) return
    let cancelled = false

    metricsLoaderRef
      .current(region, namespace)
      .then((r) => {
        if (!cancelled) setNsMetrics(r.metrics)
      })
      .catch(() => {
        // Fall back to the (possibly truncated) region-wide sweep.
      })

    return () => {
      cancelled = true
    }
  }, [region, namespace, refreshKey])

  const namespaces = useMemo(() => cloudWatchNamespaces(metrics), [metrics])

  const metricNames = useMemo(
    () => cloudWatchMetricNames(nsMetrics ?? metrics ?? [], namespace),
    [metrics, nsMetrics, namespace],
  )

  const dimensionCombos = useMemo(() => {
    if (!namespace || !metricName) return []
    const source = nsMetrics ?? metrics ?? []

    return source.filter((m) => m.namespace === namespace && m.name === metricName)
  }, [metrics, nsMetrics, namespace, metricName])

  // Keyed on the combo *count* rather than the memo identity: a background
  // metrics refresh that yields the same combos keeps the chart on screen.
  useResetOnKey(
    `${region}|${namespace}|${metricName}|${stat}|${String(rangeMinutes)}|${String(refreshKey)}|${String(dimensionCombos.length)}`,
    () => {
      if (!namespace || !metricName || dimensionCombos.length === 0) {
        setSeriesData(null)

        return
      }
      setTruncatedSeries(Math.max(0, dimensionCombos.length - EXPLORER_MAX_SERIES))
      setSeriesLoading(true)
      setSeriesError(null)
    },
  )
  useEffect(() => {
    if (!namespace || !metricName || dimensionCombos.length === 0) return
    const gen = ++requestGenRef.current
    const combos = dimensionCombos.slice(0, EXPLORER_MAX_SERIES)

    Promise.all(
      combos.map((combo) =>
        dataLoaderRef
          .current(region, {
            namespace,
            metricName,
            dimensions: combo.dimensions,
            stat,
            rangeMinutes,
          })
          .then((data) => ({ label: dimensionsLabel(combo.dimensions), data })),
      ),
    )
      .then((results) => {
        if (requestGenRef.current !== gen) return
        setSeriesData(results)
        setSeriesLoading(false)
      })
      .catch((e: unknown) => {
        if (requestGenRef.current !== gen) return
        setSeriesError(String(e instanceof Error ? e.message : e))
        setSeriesLoading(false)
      })
  }, [region, namespace, metricName, stat, rangeMinutes, dimensionCombos, refreshKey])

  const frames = useMemo<DataFrame[]>(() => cloudWatchSeriesFrames(seriesData), [seriesData])

  const filteredNamespaces = applyFilter(namespaces, filter, (n) => n)

  useEffect(() => {
    onCount(seriesData?.length ?? filteredNamespaces.length)
  }, [seriesData, filteredNamespaces.length, onCount])

  const hasData = frames.some((f) => (f.fields[0]?.values.length ?? 0) > 0)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zGray-800 flex items-center gap-2 text-[11.5px] flex-wrap">
        <RegionCombobox regions={AWS_REGIONS} value={region} onChange={setRegion} />
        <AppSelect
          value={namespace}
          onValueChange={(v) => {
            setNamespace(v)
            setMetricName('')
          }}
          placeholder={metricsLoading ? 'Loading namespaces…' : 'Namespace'}
          disabled={!metrics || namespaces.length === 0}
          triggerClassName="h-7 border-zGray-800 px-2 text-[12px] min-w-[180px]"
          options={namespaces.map((n) => ({ value: n, label: n }))}
        />
        <AppSelect
          value={metricName}
          onValueChange={setMetricName}
          placeholder="Metric"
          disabled={!namespace}
          triggerClassName="h-7 border-zGray-800 px-2 text-[12px] min-w-[180px]"
          options={metricNames.map((n) => ({ value: n, label: n }))}
        />
        <AppSelect
          value={stat}
          onValueChange={(v) => setStat(v as MetricStat)}
          triggerClassName="h-7 border-zGray-800 px-2 text-[12px] w-[110px]"
          options={METRIC_STATS.map((s) => ({ value: s, label: s }))}
        />
        <RangeButtons rangeMinutes={rangeMinutes} setRangeMinutes={setRangeMinutes} />
        {metricsTruncated && (
          <span
            className="text-[11px] text-amber-400"
            title="This region has more metrics than the discovery sweep returns. The namespace list may be incomplete; metrics inside a selected namespace are re-queried in full."
          >
            Namespace list truncated
          </span>
        )}
      </div>

      {metricsError ? (
        <ErrorBlock message={metricsError} />
      ) : seriesError ? (
        <ErrorBlock message={seriesError} />
      ) : !namespace || !metricName ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-tertiary px-8 text-center">
          {metricsLoading
            ? 'Listing metrics in this region…'
            : metrics && namespaces.length === 0
              ? 'No CloudWatch metrics found in this region.'
              : 'Pick a namespace and metric to chart it across all dimension combinations.'}
        </div>
      ) : seriesLoading && !seriesData ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-tertiary">
          Loading datapoints…
        </div>
      ) : (
        <MetricSeriesCard
          title={
            <>
              {namespace} · {metricName}
            </>
          }
          subtitle={
            <>
              {stat} · {seriesData?.length ?? 0} series
              {truncatedSeries > 0
                ? ` (showing first ${String(EXPLORER_MAX_SERIES)}, ${String(truncatedSeries)} more hidden)`
                : ''}
            </>
          }
          frames={frames}
          hasData={hasData}
        />
      )}
    </div>
  )
}
