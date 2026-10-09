import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { AGENT_PROVIDER } from '../../types/runtime'

import { GAP_FILL, MetricChart, RangeSwitch } from './MetricChart'
import { QUOTA_HISTORY_RANGES, quotaHistoryRows } from './quotaHistoryRows'
import { PanelHeading } from './RuntimePanel'

import type { QuotaHistoryRow } from './quotaHistoryRows'
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

const percent = (value: number) => `${String(Math.round(value))}%`

function timeLabelFor(range: RuntimeQuotaHistoryRange): (at: number) => string {
  return (at) =>
    new Date(at).toLocaleString([], {
      ...(range === '1d' ? {} : { month: 'short', day: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
    })
}

function AgentUsageRow({
  row,
  range,
  nowMs,
  onSelect,
}: {
  row: QuotaHistoryRow
  range: RuntimeQuotaHistoryRange
  nowMs: number
  onSelect: (runtimeId: string) => void
}) {
  const { instance } = row
  const domain: [number, number] = [nowMs - QUOTA_HISTORY_RANGES[range].hours * 3_600_000, nowMs]

  return (
    <div className="rounded-xl border border-zGray-800/60 bg-surface/40 px-4 pb-3 pt-3">
      <button
        type="button"
        onClick={() => onSelect(instance.id)}
        className="group -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-lg px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-zViolet-500/60"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zGray-800/70 bg-main">
          <AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-main">
          {instance.label}
        </span>
        <span className="shrink-0 text-[11px] text-tertiary">
          {AGENT_PROVIDER[instance.provider].label}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-70"
        />
      </button>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 xl:grid-cols-4">
        {row.windows.map((window) => (
          <MetricChart
            key={window.id}
            title={window.label}
            data={window.data}
            format={percent}
            timeLabel={timeLabelFor(range)}
            domain={domain}
            max={100}
            gaps={row.gaps}
          />
        ))}
      </div>
    </div>
  )
}

/** How much of each agent's subscription the team used over the last day, week or
 *  month, one row per agent with a chart per usage window. */
export function RuntimeQuotaHistory({
  teamId,
  instances,
  onSelect,
}: {
  teamId: string
  instances: readonly RuntimeInstance[]
  onSelect: (runtimeId: string) => void
}) {
  const [range, setRange] = useState<RuntimeQuotaHistoryRange>('7d')
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

  if (!loaded) return null
  const rows = quotaHistoryRows(loaded.series, instances, loaded.range, loaded.nowMs)

  return (
    <section className="mb-10">
      <PanelHeading
        title="Subscription usage"
        hint={`Highest share of each plan window used per ${QUOTA_HISTORY_RANGES[loaded.range].bucketLabel}`}
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
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zGray-800 px-4 py-6 text-center text-xs leading-5 text-tertiary">
          No usage recorded in this range yet. A reading is kept each time an agent reports its
          usage while someone on the team has Nuphos open.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <AgentUsageRow
              key={row.instance.id}
              row={row}
              range={loaded.range}
              nowMs={loaded.nowMs}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  )
}
