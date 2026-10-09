import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { ChartPlot } from '../../components/ChartPlot'

import { quotaHistoryCharts } from './quotaHistoryCharts'
import { PanelHeading } from './RuntimePanel'

import type {
  RuntimeInstance,
  RuntimeQuotaHistoryRange,
  RuntimeQuotaHistorySeries,
} from '../../types/runtime'

const RANGES: { value: RuntimeQuotaHistoryRange; label: string }[] = [
  { value: '1d', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
]
// A reading is held ten minutes on the backend, so nothing new arrives sooner.
const POLL_MS = 600_000

/** Subscription use of the team's agents over the last day, week or month. Renders
 *  nothing until some agent has a recorded reading. */
export function RuntimeQuotaHistory({
  teamId,
  instances,
}: {
  teamId: string
  instances: readonly RuntimeInstance[]
}) {
  const [range, setRange] = useState<RuntimeQuotaHistoryRange>('1d')
  const [series, setSeries] = useState<RuntimeQuotaHistorySeries[]>([])

  useEffect(() => {
    let cancelled = false
    const load = () =>
      void api.atlasGetRuntimeQuotaHistory(teamId, range).then(
        (next) => {
          if (!cancelled) setSeries(next)
        },
        () => {
          /* History is decoration; keep whatever was shown before. */
        },
      )

    load()
    const timer = setInterval(load, POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [teamId, range])

  const charts = quotaHistoryCharts(series, instances, range)

  if (charts.length === 0) return null

  return (
    <section className="mb-8">
      <PanelHeading
        title="Subscription usage"
        hint="Highest share of each usage window used, per agent"
        right={
          <div
            className="flex gap-0.5 rounded-md border border-zGray-800/70 p-0.5"
            role="radiogroup"
            aria-label="Time range"
          >
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={range === r.value}
                onClick={() => setRange(r.value)}
                className={clsx(
                  'rounded px-1.5 py-0.5 text-[11px]',
                  range === r.value
                    ? 'bg-zGray-800/80 text-main'
                    : 'text-tertiary hover:bg-zGray-800/40 hover:text-main',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-6">
        {charts.map((chart) => (
          <div key={chart.title}>
            <div className="mb-1 text-[11px] text-tertiary">{chart.title} (%)</div>
            <ChartPlot payload={chart} />
          </div>
        ))}
      </div>
    </section>
  )
}
