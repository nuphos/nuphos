import { useState } from 'react'

import { t } from '../../i18n'
import { useRuntimeMetricsQuery } from '../../lib/query/runtime'

import { MetricChart, RangeSwitch } from './MetricChart'
import { PanelHeading } from './RuntimePanel'
import { reportedSeries } from './runtimePresentation'

import type { RuntimeMetricKey } from './runtimePresentation'

const WINDOWS = [
  { hours: 1, label: t('1h') },
  { hours: 6, label: t('6h') },
  { hours: 24, label: t('24h') },
] as const

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
  { key: 'memoryBytes', title: t('Memory'), format: (v) => `${(v / 2 ** 20).toFixed(0)} MiB` },
  { key: 'diskUsedBytes', title: t('Disk'), format: gibibytes, capacityKey: 'diskTotalBytes' },
  { key: 'sessions', title: t('Agents'), format: (v) => String(Math.round(v)) },
]

function timeLabel(at: number | string): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** CPU, memory, disk and session charts for one runtime, refreshed every 30s. A series
 *  with no reading in the window is left out, and nothing renders until the runtime has
 *  reported something: an older runtime image may predate usage reporting. */
export function RuntimeMetricsCharts({ teamId, runtimeId }: { teamId: string; runtimeId: string }) {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]['hours']>(1)
  const { data: samples, isError: failed } = useRuntimeMetricsQuery(teamId, runtimeId, hours)

  const first = samples?.[0]
  const last = samples?.at(-1)
  const metrics = samples ? reportedSeries(samples, METRICS) : []

  if (!samples || metrics.length === 0) return null

  return (
    <div className="@container px-4 py-4">
      <PanelHeading
        title={t('Resource usage')}
        hint={first && last ? `${timeLabel(first.at)} – ${timeLabel(last.at)}` : undefined}
        right={
          <RangeSwitch
            options={WINDOWS.map((w) => ({ value: w.hours, label: w.label }))}
            value={hours}
            onChange={setHours}
            label={t('Time window')}
          />
        }
      />
      {failed ? (
        <p className="text-xs text-error">{t('Could not load resource usage. Retrying…')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 @md:grid-cols-4">
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
