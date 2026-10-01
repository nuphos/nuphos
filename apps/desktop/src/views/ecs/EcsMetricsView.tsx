import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useReportLoading } from '../../components/useReportLoading'

import { ErrorBlock } from './ErrorBlock'
import { useLoader } from './shared'

import type { CommonProps } from './shared'
import type { AwsEcsClusterMetricsResponse } from '../../types'

const METRIC_LABELS: Record<string, string> = {
  CPUUtilization: 'CPU Utilization',
  MemoryUtilization: 'Memory Utilization',
  CPUReservation: 'CPU Reservation',
  MemoryReservation: 'Memory Reservation',
}

const RANGE_OPTIONS: readonly { label: string; minutes: number }[] = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
  { label: '12h', minutes: 720 },
  { label: '1d', minutes: 1440 },
]

function formatTime(ts: string): string {
  const d = new Date(ts)

  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function EcsMetricsView({
  loader,
  refreshKey,
  onLoading,
  onCount,
}: Omit<CommonProps, 'filter'> & {
  loader: (rangeMinutes: number) => Promise<AwsEcsClusterMetricsResponse>
}) {
  const [rangeMinutes, setRangeMinutes] = useState<number>(60)
  const { items, loading, error } = useLoader<AwsEcsClusterMetricsResponse | null>(
    () => loader(rangeMinutes),
    [refreshKey, rangeMinutes],
    null,
  )

  useReportLoading(loading, onLoading)

  useEffect(() => {
    onCount(items?.series.length ?? 0)
  }, [items, onCount])

  const chartData = useMemo(() => {
    if (!items) return [] as Record<string, number | string | null>[]
    const byTimestamp = new Map<string, Record<string, number | string | null>>()

    for (const s of items.series) {
      for (const p of s.datapoints) {
        const row = byTimestamp.get(p.timestamp) ?? { timestamp: p.timestamp }

        row[s.metricName] = p.average
        byTimestamp.set(p.timestamp, row)
      }
    }

    return Array.from(byTimestamp.values()).sort((a, b) =>
      String(a.timestamp).localeCompare(String(b.timestamp)),
    )
  }, [items])

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zGray-850 bg-zGray-950 text-[12px]">
        <span className="text-tertiary mr-1">Time range</span>
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.minutes}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              setRangeMinutes(opt.minutes)
            }}
            onClick={(event) => {
              // Keyboard only — pointer presses already fired at pointerdown.
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
        {items && (
          <span className="ml-auto text-tertiary">
            Period {items.periodSec}s · CloudWatch AWS/ECS
          </span>
        )}
      </div>
      {loading && !items ? (
        <div className="p-8 text-tertiary text-[13px]">Loading metrics…</div>
      ) : items && items.series.every((s) => s.datapoints.length === 0) ? (
        <div className="p-8 text-tertiary text-[13px]">
          No CloudWatch datapoints in this range. The role may be missing
          cloudwatch:GetMetricStatistics, or the cluster has no activity yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-4 p-4">
          {items?.series.map((s) => (
            <div key={s.metricName} className="bg-zGray-950 border border-zGray-850 rounded-md p-3">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-[13px] font-medium text-main">
                  {METRIC_LABELS[s.metricName] ?? s.metricName}
                </span>
                <span className="text-[11.5px] text-tertiary">
                  {s.datapoints.length} pts · {s.unit}
                </span>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id={`grad-${s.metricName}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(164, 105, 255)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="rgb(164, 105, 255)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2730" />
                    <XAxis
                      dataKey="timestamp"
                      tick={{ fill: '#8a8194', fontSize: 11 }}
                      tickFormatter={(ts) => formatTime(String(ts))}
                      minTickGap={40}
                    />
                    <YAxis
                      tick={{ fill: '#8a8194', fontSize: 11 }}
                      width={36}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${String(v)}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#16141a',
                        border: '1px solid #2a2730',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      labelFormatter={(ts) => new Date(String(ts)).toLocaleString()}
                      formatter={(value: number | string) => {
                        if (typeof value !== 'number') return ['—', s.metricName]

                        return [`${value.toFixed(2)}%`, METRIC_LABELS[s.metricName] ?? s.metricName]
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey={s.metricName}
                      stroke="rgb(164, 105, 255)"
                      strokeWidth={1.5}
                      fill={`url(#grad-${s.metricName})`}
                      isAnimationActive={false}
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
