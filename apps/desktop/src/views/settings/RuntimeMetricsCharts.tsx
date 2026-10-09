import { useEffect, useState } from 'react'

import { api } from '../../api'

import { MetricChart, RangeSwitch } from './MetricChart'
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

function timeLabel(at: number | string): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
          <RangeSwitch
            options={WINDOWS.map((w) => ({ value: w.hours, label: w.label }))}
            value={hours}
            onChange={setHours}
            label="Time window"
          />
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
              data={samples.map((sample) => ({
                at: Date.parse(sample.at),
                value: sample[metric.key],
                capacity: metric.capacityKey ? sample[metric.capacityKey] : null,
              }))}
              format={metric.format}
              timeLabel={timeLabel}
            />
          ))}
        </div>
      )}
    </div>
  )
}
