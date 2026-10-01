import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { api } from '../../api'

import { PanelHeading } from './RuntimePanel'
import { reportedSeries } from './runtimePresentation'

import type { RuntimeMetricKey } from './runtimePresentation'
import type { RuntimeMetricSample } from '../../types/runtime'

const WINDOWS = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
] as const
const POLL_MS = 30_000
const ACCENT = 'rgb(164, 105, 255)'
const CAPACITY = 'rgb(118, 124, 140)'

function gibibytes(value: number): string {
  return `${(value / 2 ** 30).toFixed(value < 10 * 2 ** 30 ? 1 : 0)} GiB`
}

/** `capacityKey` draws a second, dimmed line the metric is measured against —
 *  disk used means little without the size of the volume next to it. */
const METRICS: {
  key: RuntimeMetricKey
  title: string
  format: (value: number) => string
  capacityKey?: 'diskTotalBytes'
}[] = [
  { key: 'cpuMillicores', title: 'CPU', format: (v) => `${v.toFixed(v < 10 ? 1 : 0)}m` },
  { key: 'memoryBytes', title: 'Memory', format: (v) => `${(v / 2 ** 20).toFixed(0)} MiB` },
  { key: 'diskUsedBytes', title: 'Disk', format: gibibytes, capacityKey: 'diskTotalBytes' },
  { key: 'sessions', title: 'Sessions', format: (v) => String(Math.round(v)) },
]

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function MetricChart({
  title,
  samples,
  metricKey,
  format,
  capacityKey,
}: {
  title: string
  samples: RuntimeMetricSample[]
  metricKey: RuntimeMetricKey
  format: (value: number) => string
  capacityKey?: 'diskTotalBytes'
}) {
  const data = samples.map((s) => ({
    at: s.at,
    value: s[metricKey],
    capacity: capacityKey ? s[capacityKey] : null,
  }))
  const newest = [...samples].reverse()
  const latest = newest.find((s) => s[metricKey] !== null)?.[metricKey] ?? null
  const latestCapacity = capacityKey
    ? (newest.find((s) => s[capacityKey] !== null)?.[capacityKey] ?? null)
    : null

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-tertiary">{title}</span>
        <span className="font-mono text-main">
          {latest === null ? '—' : format(latest)}
          {latestCapacity === null ? null : (
            <span className="text-tertiary"> / {format(latestCapacity)}</span>
          )}
        </span>
      </div>
      <div className="mt-1 h-16 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="at" hide />
            <YAxis hide domain={[0, 'auto']} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: 'rgba(164, 105, 255, 0.4)' }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as
                  { at: string; value: number | null; capacity: number | null } | undefined

                if (!active || !point) return null

                return (
                  <div className="rounded-md border border-zGray-800 bg-zGray-950/95 px-2 py-1 text-[11px] shadow-lg">
                    <div className="text-tertiary">{timeLabel(point.at)}</div>
                    <div className="font-mono text-main">
                      {point.value === null ? '—' : format(point.value)}
                      {point.capacity === null ? null : (
                        <span className="text-tertiary"> / {format(point.capacity)}</span>
                      )}
                    </div>
                  </div>
                )
              }}
            />
            {capacityKey ? (
              <Area
                type="monotone"
                dataKey="capacity"
                stroke={CAPACITY}
                strokeWidth={1}
                strokeDasharray="3 3"
                fill="none"
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="value"
              stroke={ACCENT}
              strokeWidth={1.5}
              fill={ACCENT}
              fillOpacity={0.15}
              connectNulls={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** CPU, memory, disk and session charts for one runtime, refreshed every 30s. A series
 *  with no reading in the window is left out, and nothing renders until the runtime has
 *  reported something: an older runtime image may predate usage reporting. */
export function RuntimeMetricsCharts({ teamId, runtimeId }: { teamId: string; runtimeId: string }) {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]['hours']>(1)
  const [samples, setSamples] = useState<RuntimeMetricSample[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      void api.atlasGetRuntimeInstanceMetrics(teamId, runtimeId, hours).then(
        (metrics) => {
          if (cancelled) return
          setSamples(metrics.samples)
          setFailed(false)
        },
        () => {
          if (!cancelled) setFailed(true)
        },
      )

    load()
    const timer = setInterval(load, POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [teamId, runtimeId, hours])

  const first = samples?.[0]
  const last = samples?.at(-1)
  const metrics = samples ? reportedSeries(samples, METRICS) : []

  if (!samples || metrics.length === 0) return null

  return (
    <div className="px-4 py-4">
      <PanelHeading
        title="Resource usage"
        hint={first && last ? `${timeLabel(first.at)} – ${timeLabel(last.at)}` : undefined}
        right={
          <div
            className="flex gap-0.5 rounded-md border border-zGray-800/70 p-0.5"
            role="radiogroup"
            aria-label="Time window"
          >
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                type="button"
                role="radio"
                aria-checked={hours === w.hours}
                onClick={() => setHours(w.hours)}
                className={clsx(
                  'rounded px-1.5 py-0.5 text-[11px]',
                  hours === w.hours
                    ? 'bg-zGray-800/80 text-main'
                    : 'text-tertiary hover:bg-zGray-800/40 hover:text-main',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />
      {failed ? (
        <p className="text-xs text-error">Could not load resource usage. Retrying…</p>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {metrics.map((metric) => (
            <MetricChart
              key={metric.key}
              title={metric.title}
              samples={samples}
              metricKey={metric.key}
              format={metric.format}
              capacityKey={metric.capacityKey}
            />
          ))}
        </div>
      )}
    </div>
  )
}
