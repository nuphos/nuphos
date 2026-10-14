import { useEffect, useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'

import { AGENT_USAGE_COLUMNS, AgentUsageRow, LIMIT_FILL } from './AgentUsageRow'
import { GAP_FILL, RangeSwitch } from './MetricChart'
import { QUOTA_HISTORY_RANGES, quotaHistoryRows } from './quotaHistoryRows'
import { PanelHeading } from './RuntimePanel'

import type { MetricPoint } from './MetricChart'
import type { QuotaHistoryRow } from './quotaHistoryRows'
import type {
  RuntimeInstance,
  RuntimeQuota,
  RuntimeQuotaHistoryRange,
  RuntimeQuotaHistorySeries,
} from '../../types/runtime'

const RANGE_OPTIONS = (Object.keys(QUOTA_HISTORY_RANGES) as RuntimeQuotaHistoryRange[]).map(
  (value) => ({ value, label: QUOTA_HISTORY_RANGES[value].label }),
)
// A reading is held ten minutes on the backend, so nothing new arrives sooner.
const POLL_MS = 600_000
const LEGEND_STEPS = [10, 40, 70, 95]
// Enough cells to read a day at a glance; finer buckets fold into their busiest.
const MAX_CELLS = 72

const percent = (value: number) => `${String(Math.round(value))}%`

function timeLabelFor(range: RuntimeQuotaHistoryRange): (at: number) => string {
  return (at) =>
    new Date(at).toLocaleString([], {
      ...(range === '1d' ? {} : { month: 'short', day: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
    })
}

function foldCells(points: MetricPoint[]): MetricPoint[] {
  const size = Math.ceil(points.length / MAX_CELLS)

  return Array.from({ length: Math.ceil(points.length / size) }, (_, i) => {
    const chunk = points.slice(i * size, (i + 1) * size)
    const values = chunk.flatMap((p) => (p.value === null ? [] : [p.value]))

    return { at: chunk[0].at, value: values.length > 0 ? Math.max(...values) : null }
  })
}

/** Darker the more of the plan a bucket used; a used-up window turns orange. */
function cellColor(value: number | null): string | undefined {
  if (value === null) return GAP_FILL
  if (value >= 100) return LIMIT_FILL

  // Starts well above GAP_FILL so a quiet agent never reads as one that did not report.
  return `rgba(var(--color-zViolet-500), ${String(0.2 + (0.8 * value) / 100)})`
}

function UsageHeatmap({
  rows,
  range,
  nowMs,
  onSelect,
}: {
  rows: QuotaHistoryRow[]
  range: RuntimeQuotaHistoryRange
  nowMs: number
  onSelect: (runtimeId: string) => void
}) {
  const timeLabel = timeLabelFor(range)
  const from = nowMs - QUOTA_HISTORY_RANGES[range].hours * 3_600_000
  const ticks = [0, 0.25, 0.5, 0.75].map((f) => from + f * (nowMs - from))

  return (
    <div className="mb-4 rounded-xl border border-zGray-800/60 bg-surface/40 px-4 pb-3 pt-3">
      <div className="mb-3 flex items-center gap-1.5 text-[11px] text-tertiary">
        <span className="mr-auto text-[13px] font-medium text-main">
          Highest plan window, every agent
        </span>
        <span>0%</span>
        {LEGEND_STEPS.map((step) => (
          <span
            key={step}
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: cellColor(step) }}
          />
        ))}
        <span>99%</span>
        <span
          aria-hidden="true"
          className="ml-2 h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: LIMIT_FILL }}
        />
        <span>At limit</span>
      </div>
      <div className="space-y-[3px]">
        {rows.map((row) => (
          <button
            key={row.instance.id}
            type="button"
            // The table below covers keyboard access; one tab stop per agent is enough.
            tabIndex={-1}
            onClick={() => onSelect(row.instance.id)}
            className="group flex w-full items-center gap-3 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-zViolet-500/60"
          >
            <span className="flex w-40 shrink-0 items-center gap-2 text-[11.5px] text-secondary group-hover:text-main">
              <AgentProviderIcon provider={row.instance.provider} className="h-3 w-3 shrink-0" />
              <span className="truncate">{row.instance.label}</span>
            </span>
            <span className="flex min-w-0 flex-1 gap-[2px]">
              {foldCells(row.peak).map((point) => (
                <span
                  key={point.at}
                  title={`${timeLabel(point.at)} · ${point.value === null ? 'No reading' : percent(point.value)}`}
                  className="h-3 min-w-0 flex-1 rounded-[2px]"
                  style={{ backgroundColor: cellColor(point.value) }}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-3 font-mono text-[10.5px] text-tertiary">
        <span className="w-40 shrink-0" />
        <span className="flex min-w-0 flex-1 justify-between">
          {ticks.map((at) => (
            <span key={at}>{timeLabel(at)}</span>
          ))}
          <span>Now</span>
        </span>
      </div>
    </div>
  )
}

/** How much of each agent's subscription the team used over the last day, week or
 *  month: a heatmap of every agent's busiest plan window, then one row per agent. */
export function RuntimeQuotaHistory({
  teamId,
  instances,
  quotas,
  selectedId,
  onSelect,
}: {
  teamId: string
  instances: readonly RuntimeInstance[]
  quotas: ReadonlyMap<string, RuntimeQuota>
  selectedId: string | null
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
  const rowById = new Map(rows.map((row) => [row.instance.id, row]))
  const shownRange = loaded?.range ?? range

  return (
    <section className="mb-10">
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
      {loaded &&
        (rows.length === 0 ? (
          <p className="mb-4 rounded-xl border border-dashed border-zGray-800 px-4 py-6 text-center text-xs leading-5 text-tertiary">
            No usage recorded in this range yet. A reading is kept each time an agent reports its
            usage while someone on the team has Nuphos open.
          </p>
        ) : (
          <UsageHeatmap rows={rows} range={loaded.range} nowMs={loaded.nowMs} onSelect={onSelect} />
        ))}
      <div className="overflow-hidden rounded-xl border border-zGray-800/60 bg-surface/40">
        <div
          className={`grid ${AGENT_USAGE_COLUMNS} border-b border-zGray-800/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary`}
        >
          <span>Agent</span>
          <span>Runs on</span>
          <span>Usage</span>
          <span>Last {QUOTA_HISTORY_RANGES[shownRange].label}</span>
        </div>
        {instances.map((instance) => (
          <AgentUsageRow
            key={instance.id}
            instance={instance}
            quota={quotas.get(instance.id)}
            row={rowById.get(instance.id)}
            selected={selectedId === instance.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}
