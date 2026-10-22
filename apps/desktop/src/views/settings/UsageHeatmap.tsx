import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'

import { AgentProviderIcon } from '../../components/agent/panel/icons'

import { LIMIT_FILL } from './AgentUsageRow'
import { ACCENT_RGB, GAP_FILL } from './MetricChart'
import { QUOTA_HISTORY_RANGES } from './quotaHistoryRows'

import type { MetricPoint } from './MetricChart'
import type { QuotaHistoryRow } from './quotaHistoryRows'
import type { RuntimeQuotaHistoryRange } from '../../types/runtime'

const LEGEND_STEPS = [10, 40, 70, 95]
// Enough cells to read a day at a glance; finer buckets fold into their busiest.
const MAX_CELLS = 72
// Each cell keeps at least this much room (with its gap), so a narrow page gets
// fewer, wider cells rather than dots.
const MIN_CELL_PX = 11

const percent = (value: number) => `${String(Math.round(value))}%`

function timeLabelFor(range: RuntimeQuotaHistoryRange): (at: number) => string {
  return (at) =>
    new Date(at).toLocaleString([], {
      ...(range === '1d' ? {} : { month: 'short', day: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
    })
}

function foldCells(points: MetricPoint[], maxCells: number): MetricPoint[] {
  const size = Math.ceil(points.length / maxCells)

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
  // Ten even steps of 10%, darkest at 90% and above.
  const step = Math.min(9, Math.floor(value / 10))

  return `rgba(${ACCENT_RGB}, ${String(0.22 + (0.78 * step) / 9)})`
}

/** Every agent's busiest plan window over the range, one row each, one cell per
 *  (folded) bucket, with a tooltip for the cell under the pointer. */
export function UsageHeatmap({
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
  const [cells, setCells] = useState<HTMLSpanElement | null>(null)
  const [card, setCard] = useState<HTMLDivElement | null>(null)
  // One tooltip for the whole grid, placed over the hovered cell.
  const [hover, setHover] = useState<{
    x: number
    y: number
    agent: string
    point: MetricPoint
  } | null>(null)
  const showCell = (event: MouseEvent<HTMLElement>, agent: string, point: MetricPoint) => {
    if (!card) return
    const cell = event.currentTarget.getBoundingClientRect()
    const box = card.getBoundingClientRect()

    setHover({ x: cell.left + cell.width / 2 - box.left, y: cell.top - box.top, agent, point })
  }
  const [cellsWidth, setCellsWidth] = useState(0)
  const maxCells = cellsWidth
    ? Math.max(12, Math.min(MAX_CELLS, Math.floor(cellsWidth / MIN_CELL_PX)))
    : MAX_CELLS

  useEffect(() => {
    if (!cells) return
    const observer = new ResizeObserver(([entry]) => setCellsWidth(entry?.contentRect.width ?? 0))

    observer.observe(cells)

    return () => observer.disconnect()
  }, [cells])

  return (
    <div
      ref={setCard}
      className="relative mb-4 rounded-xl border border-zGray-800/60 bg-surface/40 px-4 pb-3 pt-3"
    >
      <div className="mb-3 flex items-center gap-1.5 text-[11px] text-tertiary">
        <span className="mr-auto text-[13px] font-medium text-main">
          Highest plan window, every runtime
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
      <div className="space-y-[3px]" onMouseLeave={() => setHover(null)}>
        {rows.map((row) => (
          <button
            key={row.instance.id}
            type="button"
            // The table below covers keyboard access; one tab stop per agent is enough.
            tabIndex={-1}
            onClick={() => onSelect(row.instance.id)}
            className="group flex w-full items-center gap-3 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-zViolet-500/60"
          >
            <span className="flex w-28 shrink-0 items-center gap-2 text-[11.5px] text-secondary group-hover:text-main @3xl:w-40">
              <AgentProviderIcon provider={row.instance.provider} className="h-3 w-3 shrink-0" />
              <span className="truncate">{row.instance.label}</span>
            </span>
            <span
              ref={row === rows[0] ? setCells : undefined}
              className="flex min-w-0 flex-1 gap-[2px]"
            >
              {foldCells(row.peak, maxCells).map((point) => (
                <span
                  key={point.at}
                  onMouseEnter={(event) => showCell(event, row.instance.label, point)}
                  className="aspect-square min-w-0 flex-1 rounded-[2px] transition-[background-color] duration-300 motion-reduce:transition-none"
                  style={{ backgroundColor: cellColor(point.value) }}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-3 font-mono text-[10.5px] text-tertiary">
        <span className="w-28 shrink-0 @3xl:w-40" />
        <span className="flex min-w-0 flex-1 justify-between">
          {ticks.map((at, i) => (
            <span key={at} className={i % 2 === 1 ? 'hidden @3xl:inline' : undefined}>
              {timeLabel(at)}
            </span>
          ))}
          <span>Now</span>
        </span>
      </div>
      {hover && (
        <div
          role="tooltip"
          style={{ left: hover.x, top: hover.y }}
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full pb-1.5"
        >
          <div className="whitespace-nowrap rounded-md border border-zGray-800 bg-zGray-950/95 px-2 py-1 text-[11px] shadow-lg">
            <div className="text-tertiary">
              {hover.agent} · {timeLabel(hover.point.at)}
            </div>
            <div className="font-mono text-main">
              {hover.point.value === null
                ? 'No reading'
                : hover.point.value >= 100
                  ? 'At limit'
                  : percent(hover.point.value)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
