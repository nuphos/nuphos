import { faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useReportLoading } from '../../components/useReportLoading'
import { TimeSeriesPanel } from '../../grafana/components/TimeSeriesPanel'
import { useResetOnKey } from '../useResetOnKey'

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
  fn,
  loader,
  onCount,
  onLoading,
}: {
  fn: AwsLambdaFunction
  loader: (fn: AwsLambdaFunction, rangeMinutes: number) => Promise<AwsLambdaMetricsResponse>
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
}) {
  const [rangeMinutes, setRangeMinutes] = useState(60)
  const [data, setData] = useState<AwsLambdaMetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current = loader
  })
  useReportLoading(loading, onLoading)

  useResetOnKey(`${fn.name}|${fn.region}|${String(rangeMinutes)}|${String(reloadTick)}`, () => {
    setLoading(true)
    setErrorMessage(null)
  })
  useEffect(() => {
    let cancelled = false

    loaderRef
      .current(fn, rangeMinutes)
      .then((res) => {
        if (cancelled) return
        setData(res)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErrorMessage(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fn, rangeMinutes, reloadTick])

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
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zGray-850 text-[12px]">
        <span className="text-tertiary mr-1">Time range</span>
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
                ? 'bg-zViolet-500/15 text-zViolet-accent'
                : 'bg-zGray-850 hover:bg-zGray-800 text-secondary hover:text-main'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setReloadTick((t) => t + 1)}
          className="ml-2 inline-flex items-center gap-1 text-tertiary hover:text-main text-[12px]"
          title="Reload metrics"
        >
          <FontAwesomeIcon
            icon={faRotateRight}
            className={`w-3.5 h-3.5${loading ? ' animate-spin' : ''}`}
          />
        </button>
        {data && (
          <span className="ml-auto text-tertiary">
            Period {data.periodSec}s · CloudWatch AWS/Lambda
          </span>
        )}
      </div>
      {loading && !data ? (
        <div className="p-8 text-tertiary text-[13px]">Loading metrics…</div>
      ) : data && data.series.every((s) => s.datapoints.length === 0) ? (
        <div className="p-8 text-tertiary text-[13px]">
          No CloudWatch datapoints in this range. The function may be idle, or the role may be
          missing cloudwatch:GetMetricStatistics.
        </div>
      ) : (
        <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-4 p-4">
          {charts.map((s) => (
            <div key={s.metricName} className="bg-zGray-950 border border-zGray-850 rounded-md p-3">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-[13px] font-medium text-main">{s.metricName}</span>
                <span className="text-[11.5px] text-tertiary">
                  {s.stat} · {s.datapoints.length} pts
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
