import { useState } from 'react'

import { t } from '../../i18n'
import { useRuntimeQuotaHistoryQuery } from '../../lib/query/runtime'

import { HeatmapSkeleton } from './AgentUsageSkeleton'
import { GAP_FILL, RangeSwitch } from './MetricChart'
import { QUOTA_HISTORY_RANGES, quotaHistoryRows } from './quotaHistoryRows'
import { PanelHeading } from './RuntimePanel'
import { UsageHeatmap } from './UsageHeatmap'

import type { RuntimeInstance, RuntimeQuotaHistoryRange } from '../../types/runtime'

const RANGE_OPTIONS = (Object.keys(QUOTA_HISTORY_RANGES) as RuntimeQuotaHistoryRange[]).map(
  (value) => ({ value, label: QUOTA_HISTORY_RANGES[value].label }),
)

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
  // History is decoration: a failed read keeps whatever was shown before.
  const { data: loaded } = useRuntimeQuotaHistoryQuery(teamId, range)

  const rows = loaded ? quotaHistoryRows(loaded.series, instances, loaded.range, loaded.nowMs) : []
  const shownRange = loaded?.range ?? range

  return (
    <section className="@container">
      <PanelHeading
        title={t('Subscription usage')}
        hint={t('Highest share of each plan window used per {bucket}', {
          bucket: QUOTA_HISTORY_RANGES[shownRange].bucketLabel,
        })}
        right={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: GAP_FILL }}
              />
              {t('No reading')}
            </span>
            <RangeSwitch
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
              label={t('Time range')}
            />
          </div>
        }
      />
      {!loaded && <HeatmapSkeleton rows={Math.min(instances.length, 8)} />}
      {loaded &&
        (rows.length === 0 ? (
          <p className="mb-4 rounded-xl border border-dashed border-line-control px-4 py-6 text-center text-xs leading-5 text-tertiary">
            {t(
              'No usage recorded in this range yet. A reading is kept each time a runtime reports its usage while someone on the team has Nuphos open.',
            )}
          </p>
        ) : (
          <UsageHeatmap rows={rows} range={loaded.range} nowMs={loaded.nowMs} onSelect={onSelect} />
        ))}
    </section>
  )
}
