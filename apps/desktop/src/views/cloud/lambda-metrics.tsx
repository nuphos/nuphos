import { faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useReportLoading } from '../../components/useReportLoading'
import { TimeSeriesPanel } from '../../grafana/components/TimeSeriesPanel'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'

import { ErrorBlock } from './ErrorBlock'

import type { DataFrame } from '../../grafana/types'
import type { AwsLambdaFunction, AwsLambdaMetricsResponse } from '../../types'

const LAMBDA_RANGE_OPTIONS: readonly { label: string; minutes: number }[] = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
  { label: '12h', minutes: 720 },
  { label: '1d', minutes: 1440 },
]

export function LambdaMetricsPanel({
  scope,
  fn,
  loader,
  onCount,
  onLoading,
}: {
  scope: string
  fn: AwsLambdaFunction
  loader: (fn: AwsLambdaFunction, rangeMinutes: number) => Promise<AwsLambdaMetricsResponse>
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}) {
  const [rangeMinutes, setRangeMinutes] = useState(60)
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current = loader
  })

  const metrics = useQuery({
    queryKey: queryKeys.lambda(scope, fn.region, fn.name, 'metrics', rangeMinutes),
    queryFn: () => loaderRef.current(fn, rangeMinutes),
    // A new range keeps the last charts on screen while it loads.
    placeholderData: keepPreviousData,
  })
  const data = metrics.data ?? null
  const loading = metrics.isFetching
  const errorMessage = metrics.error?.message ?? null

  useReportLoading(loading, onLoading)

  useEffect(() => {
    onCount(data?.series.length ?? 0)
  }, [data, onCount])

  const charts = useMemo(
    () =>
      (data?.series ?? []).map((s) => {
        const frame: DataFrame = {
          refId: s.metricName,
          name: `${s.metricName} (${s.stat})`,
          fields: [
            {
              name: 'time',
              type: 'time',
              values: s.datapoints.map((p) => Date.parse(p.timestamp)),
            },
            {
              name: s.metricName,
              type: 'number',
              values: s.datapoints.map((p) => p.value),
            },
          ],
        }

        return { ...s, frame }
      }),
    [data],
  )

  if (errorMessage) return <ErrorBlock message={errorMessage} />

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto scrollbar-thin">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-line-control text-[12px]">
        <span className="text-tertiary mr-1">{t('Time range')}</span>
        {LAMBDA_RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.minutes}
            type="button"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              setRangeMinutes(opt.minutes)
            }}
            onClick={(event) => {
              if (event.detail !== 0) return
              setRangeMinutes(opt.minutes)
            }}
            className={`h-7 px-2.5 rounded-md text-[12.5px] font-medium ${
              rangeMinutes === opt.minutes
                ? 'bg-state-selected text-primary'
                : 'bg-surface-sunken hover:bg-state-hover text-secondary hover:text-main'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void metrics.refetch()}
          className="ml-2 inline-flex items-center gap-1 text-tertiary hover:text-main text-[12px]"
          title={t('Reload metrics')}
        >
          <FontAwesomeIcon
            icon={faRotateRight}
            className={`w-3.5 h-3.5${loading ? ' animate-spin' : ''}`}
          />
        </button>
        {data && (
          <span className="ml-auto text-tertiary">
            {t('Period {n}s · CloudWatch AWS/Lambda', { n: data.periodSec })}
          </span>
        )}
      </div>
      {loading && !data ? (
        <div className="p-8 text-tertiary text-[13px]">{t('Loading metrics…')}</div>
      ) : data && data.series.every((s) => s.datapoints.length === 0) ? (
        <div className="p-8 text-tertiary text-[13px]">
          {t(
            'No CloudWatch datapoints in this range. The function may be idle, or the role may be missing cloudwatch:GetMetricStatistics.',
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-4 p-4">
          {charts.map((s) => (
            <div
              key={s.metricName}
              className="bg-surface-canvas border border-line-control rounded-md p-3"
            >
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-[13px] font-medium text-main">{s.metricName}</span>
                <span className="text-[11.5px] text-tertiary">
                  {t('{stat} · {n} pts', { stat: s.stat, n: s.datapoints.length })}
                </span>
              </div>
              <div className="h-44 relative">
                <TimeSeriesPanel
                  frames={[s.frame]}
                  unit={s.unit === 'Milliseconds' ? 'ms' : undefined}
                  targets={[{ refId: s.metricName, legendFormat: `${s.metricName} (${s.stat})` }]}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
