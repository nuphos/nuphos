import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { useRefreshKey } from '../../lib/query/tabQuery'
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
  AwsCloudWatchMetricData,
  AwsCloudWatchMetricListing,
  AwsCloudWatchMetricQuery,
} from '../../types'

// Lightweight CloudWatch metrics explorer: region → namespace → metric, then
// every dimension combination (capped) is charted as its own series.
export function CloudWatchMetricsExplorerView({
  scope: sharedScope,
  metricsLoader,
  dataLoader,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  /** Names the team, account and role the metrics are read through; unset until the role resolves. */
  scope: string | undefined
  metricsLoader: (region: string, namespace?: string) => Promise<AwsCloudWatchMetricListing>
  dataLoader: (region: string, query: AwsCloudWatchMetricQuery) => Promise<AwsCloudWatchMetricData>
}) {
  const [region, setRegion] = useState('us-east-1')
  const ownScope = useId()
  const scope = sharedScope ?? ownScope
  const [namespace, setNamespace] = useState('')
  const [metricName, setMetricName] = useState('')
  const [stat, setStat] = useState<MetricStat>('Average')
  const [rangeMinutes, setRangeMinutes] = useState(180)
  const metricsLoaderRef = useRef(metricsLoader)
  const dataLoaderRef = useRef(dataLoader)

  useEffect(() => {
    metricsLoaderRef.current = metricsLoader
    dataLoaderRef.current = dataLoader
  })

  // One ListMetrics sweep per region; namespaces/metrics derive from it.
  useResetOnKey(region, () => {
    setNamespace('')
    setMetricName('')
  })
  const sweep = useQuery({
    queryKey: queryKeys.cloudWatchMetrics(scope, region),
    queryFn: () => metricsLoaderRef.current(region),
  })
  // The region-wide sweep can truncate in metric-heavy regions; re-query scoped to the chosen
  // namespace so its metric names and dimension combinations are complete. A failure falls back
  // to the sweep.
  const nsSweep = useQuery({
    queryKey: queryKeys.cloudWatchMetrics(scope, region, namespace),
    queryFn: () => metricsLoaderRef.current(region, namespace),
    enabled: Boolean(namespace),
  })
  const metrics = sweep.data?.metrics ?? null
  const metricsTruncated = sweep.data?.truncated ?? false
  const nsMetrics = namespace ? (nsSweep.data?.metrics ?? null) : null
  const metricsLoading = sweep.isPending
  const metricsError = sweep.error?.message ?? null

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

  const combos = dimensionCombos.slice(0, EXPLORER_MAX_SERIES)
  const truncatedSeries = Math.max(0, dimensionCombos.length - EXPLORER_MAX_SERIES)
  const seriesQuery = useQuery({
    queryKey: queryKeys.cloudWatchMetrics(
      scope,
      region,
      namespace,
      metricName,
      stat,
      rangeMinutes,
      ...combos.map((combo) => dimensionsLabel(combo.dimensions)),
    ),
    queryFn: () =>
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
      ),
    enabled: Boolean(namespace && metricName && combos.length > 0),
    // A background refresh that yields the same combos keeps the chart on screen.
    placeholderData: keepPreviousData,
  })
  const seriesData = namespace && metricName ? (seriesQuery.data ?? null) : null
  const seriesLoading = seriesQuery.isFetching
  const seriesError = seriesQuery.error?.message ?? null

  useRefreshKey(
    {
      isPending: metricsLoading || seriesLoading,
      refetch: () =>
        Promise.all([
          sweep.refetch(),
          namespace && nsSweep.refetch(),
          combos.length > 0 && seriesQuery.refetch(),
        ]),
    },
    refreshKey,
    onLoading,
  )

  const frames = useMemo<DataFrame[]>(() => cloudWatchSeriesFrames(seriesData), [seriesData])

  const filteredNamespaces = applyFilter(namespaces, filter, (n) => n)

  useEffect(() => {
    onCount(seriesData?.length ?? filteredNamespaces.length)
  }, [seriesData, filteredNamespaces.length, onCount])

  const hasData = frames.some((f) => (f.fields[0]?.values.length ?? 0) > 0)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-line-control flex items-center gap-2 text-[11.5px] flex-wrap">
        <RegionCombobox regions={AWS_REGIONS} value={region} onChange={setRegion} />
        <AppSelect
          value={namespace}
          onValueChange={(v) => {
            setNamespace(v)
            setMetricName('')
          }}
          placeholder={metricsLoading ? t('Loading namespaces…') : t('Namespace')}
          disabled={!metrics || namespaces.length === 0}
          triggerClassName="h-7 border-line-control px-2 text-[12px] min-w-[180px]"
          options={namespaces.map((n) => ({ value: n, label: n }))}
        />
        <AppSelect
          value={metricName}
          onValueChange={setMetricName}
          placeholder={t('Metric')}
          disabled={!namespace}
          triggerClassName="h-7 border-line-control px-2 text-[12px] min-w-[180px]"
          options={metricNames.map((n) => ({ value: n, label: n }))}
        />
        <AppSelect
          value={stat}
          onValueChange={(v) => setStat(v as MetricStat)}
          triggerClassName="h-7 border-line-control px-2 text-[12px] w-[110px]"
          options={METRIC_STATS.map((s) => ({ value: s, label: s }))}
        />
        <RangeButtons rangeMinutes={rangeMinutes} setRangeMinutes={setRangeMinutes} />
        {metricsTruncated && (
          <span
            className="text-[11px] text-status-warning"
            title={t(
              'This region has more metrics than the discovery sweep returns. The namespace list may be incomplete; metrics inside a selected namespace are re-queried in full.',
            )}
          >
            {t('Namespace list truncated')}
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
            ? t('Listing metrics in this region…')
            : metrics && namespaces.length === 0
              ? t('No CloudWatch metrics found in this region.')
              : t('Pick a namespace and metric to chart it across all dimension combinations.')}
        </div>
      ) : seriesLoading && !seriesData ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-tertiary">
          {t('Loading datapoints…')}
        </div>
      ) : (
        <MetricSeriesCard
          title={
            <>
              {namespace} · {metricName}
            </>
          }
          subtitle={
            truncatedSeries > 0
              ? t('{stat} · {n} series (showing first {max}, {hidden} more hidden)', {
                  stat,
                  n: seriesData?.length ?? 0,
                  max: EXPLORER_MAX_SERIES,
                  hidden: truncatedSeries,
                })
              : t('{stat} · {n} series', { stat, n: seriesData?.length ?? 0 })
          }
          frames={frames}
          hasData={hasData}
        />
      )}
    </div>
  )
}
