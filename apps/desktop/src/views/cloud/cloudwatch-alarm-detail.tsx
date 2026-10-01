import { Copy, Globe } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { useReportLoading } from '../../components/useReportLoading'
import { TimeSeriesPanel } from '../../grafana/components/TimeSeriesPanel'

import { alarmConditionLabel, alarmStateClass, cloudWatchAlarmUrl } from './cloudwatch-alarm-format'
import { formatLogTimestamp } from './metrics-explorer-shared'
import { RangeButtons } from './metrics-explorer-widgets'

import type { DataFrame } from '../../grafana/types'
import type {
  AwsCloudWatchAlarm,
  AwsCloudWatchAlarmHistoryItem,
  AwsCloudWatchMetricData,
} from '../../types'

export function CloudWatchAlarmDetailView({
  alarm,
  metricDataLoader,
  historyLoader,
  onCount,
  onLoading,
  refreshKey,
}: {
  alarm: AwsCloudWatchAlarm
  metricDataLoader?: (
    alarm: AwsCloudWatchAlarm,
    rangeMinutes: number,
  ) => Promise<AwsCloudWatchMetricData>
  historyLoader?: (alarm: AwsCloudWatchAlarm) => Promise<AwsCloudWatchAlarmHistoryItem[]>
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
  refreshKey: number
}) {
  const [rangeMinutes, setRangeMinutes] = useState(180)
  const [metricData, setMetricData] = useState<AwsCloudWatchMetricData | null>(null)
  const [metricLoading, setMetricLoading] = useState(false)
  const [metricError, setMetricError] = useState<string | null>(null)
  const [history, setHistory] = useState<AwsCloudWatchAlarmHistoryItem[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const metricLoaderRef = useRef(metricDataLoader)
  const historyLoaderRef = useRef(historyLoader)

  useEffect(() => {
    metricLoaderRef.current = metricDataLoader
    historyLoaderRef.current = historyLoader
  })
  const canChart = alarm.kind === 'metric' && !!alarm.metricName && !!metricDataLoader

  useReportLoading(metricLoading, onLoading)

  useEffect(() => {
    onCount(1)
  }, [onCount])

  useEffect(() => {
    const load = metricLoaderRef.current

    if (!canChart || !load) return
    let cancelled = false

    setMetricLoading(true)
    setMetricError(null)
    load(alarm, rangeMinutes)
      .then((d) => {
        if (cancelled) return
        setMetricData(d)
        setMetricLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setMetricError(String(e instanceof Error ? e.message : e))
        setMetricLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [alarm.arn, rangeMinutes, refreshKey, canChart])

  useEffect(() => {
    const load = historyLoaderRef.current

    if (!load) return
    let cancelled = false

    setHistoryError(null)
    load(alarm)
      .then((items) => {
        if (!cancelled) setHistory(items)
      })
      .catch((e: unknown) => {
        if (!cancelled) setHistoryError(String(e instanceof Error ? e.message : e))
      })

    return () => {
      cancelled = true
    }
  }, [alarm.arn, refreshKey])

  const metricFrame = useMemo<DataFrame | null>(() => {
    if (!metricData) return null

    return {
      refId: 'alarm-metric',
      name: `${String(alarm.metricName)} (${metricData.stat})`,
      fields: [
        {
          name: 'time',
          type: 'time',
          values: metricData.datapoints.map((p) => Date.parse(p.timestamp)),
        },
        {
          name: alarm.metricName ?? 'value',
          type: 'number',
          values: metricData.datapoints.map((p) => p.value),
        },
      ],
    }
  }, [metricData, alarm.metricName])

  const dimensionEntries = Object.entries(alarm.dimensions)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zGray-800 flex items-center gap-3 text-[11.5px]">
        <span className={`shrink-0 font-medium ${alarmStateClass(alarm.state)}`}>
          {alarm.state}
        </span>
        <span className="text-secondary px-1.5 py-0.5 rounded bg-zGray-800/60 shrink-0">
          {alarm.region}
        </span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(alarm.arn)}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
            title="Copy alarm ARN"
          >
            <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
            Copy ARN
          </button>
          <button
            type="button"
            onClick={() => void api.appOpenExternal(cloudWatchAlarmUrl(alarm))}
            className="inline-flex items-center gap-1 text-tertiary hover:text-main"
          >
            <Globe className="w-3.5 h-3.5" strokeWidth={1.8} />
            AWS console
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin px-4 py-3">
        <div className="max-w-4xl flex flex-col gap-4">
          {canChart && (
            <div className="bg-zGray-950 border border-zGray-850 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px] font-medium text-main">
                  {alarm.namespace} · {alarm.metricName}
                </span>
                <span className="text-[11.5px] text-tertiary">{alarmConditionLabel(alarm)}</span>
                <div className="ml-auto flex items-center gap-1">
                  <RangeButtons rangeMinutes={rangeMinutes} setRangeMinutes={setRangeMinutes} />
                </div>
              </div>
              {metricError ? (
                <div className="text-error text-[12px] py-6">{metricError}</div>
              ) : metricLoading && !metricFrame ? (
                <div className="text-tertiary text-[12px] py-6">Loading metric…</div>
              ) : metricFrame ? (
                <div className="h-52 relative">
                  <TimeSeriesPanel
                    frames={[metricFrame]}
                    targets={[
                      {
                        refId: 'alarm-metric',
                        legendFormat: `${alarm.statistic ?? ''} ${alarm.metricName ?? ''}`,
                      },
                    ]}
                  />
                </div>
              ) : null}
              {alarm.threshold != null && (
                <div className="mt-1.5 text-[11.5px] text-tertiary">
                  Threshold: {alarm.threshold}
                  {alarm.evaluationPeriods != null && alarm.periodSec != null
                    ? ` · evaluated over ${String(alarm.evaluationPeriods)}×${String(alarm.periodSec)}s`
                    : ''}
                </div>
              )}
            </div>
          )}

          <dl className="grid grid-cols-[140px,1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
              State reason
            </dt>
            <dd className="text-secondary">{alarm.stateReason ?? '—'}</dd>
            <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
              State changed
            </dt>
            <dd className="text-secondary">{alarm.stateUpdatedAt ?? '—'}</dd>
            <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
              Condition
            </dt>
            <dd className="font-mono text-secondary">{alarmConditionLabel(alarm)}</dd>
            {dimensionEntries.length > 0 && (
              <>
                <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
                  Dimensions
                </dt>
                <dd className="font-mono text-secondary">
                  {dimensionEntries.map(([k, v]) => (
                    <div key={k}>
                      {k} = {v}
                    </div>
                  ))}
                </dd>
              </>
            )}
            <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
              Actions
            </dt>
            <dd className="text-secondary">{alarm.actionsEnabled ? 'Enabled' : 'Disabled'}</dd>
            {alarm.description && (
              <>
                <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
                  Description
                </dt>
                <dd className="text-secondary">{alarm.description}</dd>
              </>
            )}
            <dt className="text-tertiary uppercase tracking-wider self-baseline text-[11px]">
              ARN
            </dt>
            <dd className="font-mono text-secondary break-all">{alarm.arn}</dd>
          </dl>

          {historyLoader && (
            <div>
              <div className="text-[11px] text-tertiary uppercase tracking-wider mb-1.5">
                History (latest 50)
              </div>
              {historyError ? (
                <div className="text-error text-[12px]">{historyError}</div>
              ) : history === null ? (
                <div className="text-tertiary text-[12px]">Loading history…</div>
              ) : history.length === 0 ? (
                <div className="text-tertiary text-[12px] italic">No recorded history.</div>
              ) : (
                <div className="border border-zGray-800 rounded bg-zGray-900 divide-y divide-zGray-850">
                  {history.map((h, i) => (
                    <div key={i} className="px-2.5 py-1.5 text-[11.5px] flex gap-3">
                      <span className="text-tertiary shrink-0 tabular-nums">
                        {formatLogTimestamp(h.timestamp)}
                      </span>
                      <span className="text-secondary">
                        {h.summary}
                        {h.type && h.type !== 'StateUpdate' ? (
                          <span className="text-tertiary"> · {h.type}</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
