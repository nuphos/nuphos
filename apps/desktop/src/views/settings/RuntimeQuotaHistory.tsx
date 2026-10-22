import { useEffect, useState } from 'react'

import { api } from '../../api'

import { HeatmapSkeleton } from './AgentUsageSkeleton'
import { GAP_FILL, RangeSwitch } from './MetricChart'
import { QUOTA_HISTORY_RANGES, quotaHistoryRows } from './quotaHistoryRows'
import { PanelHeading } from './RuntimePanel'
import { UsageHeatmap } from './UsageHeatmap'

import type {
  RuntimeInstance,
  RuntimeQuotaHistoryRange,
  RuntimeQuotaHistorySeries,
} from '../../types/runtime'

const RANGE_OPTIONS = (Object.keys(QUOTA_HISTORY_RANGES) as RuntimeQuotaHistoryRange[]).map(
  (value) => ({ value, label: QUOTA_HISTORY_RANGES[value].label }),
)
// A reading is held ten minutes on the backend, so nothing new arrives sooner.
const POLL_MS = 600_000

/** How much of each agent's subscription the team used over the last day, week or
 *  month: a heatmap of every agent's busiest plan window. */
export function RuntimeQuotaHistory({
  teamId,
  instances,
  onSelect,
}: {
  teamId: string
  instances: readonly RuntimeInstance[]
  onSelect: (runtimeId: string) => void
}) {
  const [range, setRange] = useState<RuntimeQuotaHistoryRange>('1d')
  const [loaded, setLoaded] = useState<{
    range: RuntimeQuotaHistoryRange
    series: RuntimeQuotaHistorySeries[]
    nowMs: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      void api.atlasGetRuntimeQuotaHistory(teamId, range).then(
        (series) => {
          if (!cancelled) setLoaded({ range, series, nowMs: Date.now() })
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

  const rows = loaded ? quotaHistoryRows(loaded.series, instances, loaded.range, loaded.nowMs) : []
  const shownRange = loaded?.range ?? range

  return (
    <section className="@container">
      <PanelHeading
        title="Subscription usage"
        hint={`Highest share of each plan window used per ${QUOTA_HISTORY_RANGES[shownRange].bucketLabel}`}
        right={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: GAP_FILL }}
              />
              No reading
            </span>
            <RangeSwitch
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
              label="Time range"
            />
          </div>
        }
      />
      {!loaded && <HeatmapSkeleton rows={Math.min(instances.length, 8)} />}
      {loaded &&
        (rows.length === 0 ? (
          <p className="mb-4 rounded-xl border border-dashed border-zGray-800 px-4 py-6 text-center text-xs leading-5 text-tertiary">
            No usage recorded in this range yet. A reading is kept each time a runtime reports its
            usage while someone on the team has Nuphos open.
          </p>
        ) : (
          <UsageHeatmap rows={rows} range={loaded.range} nowMs={loaded.nowMs} onSelect={onSelect} />
        ))}
    </section>
  )
}
