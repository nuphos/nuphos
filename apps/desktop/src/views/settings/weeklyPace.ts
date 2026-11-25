import { quotaBuckets } from './quotaHistoryRows.ts'

import type { MetricGap, MetricPoint } from './MetricChart'
import type {
  RuntimeQuota,
  RuntimeQuotaHistorySeries,
  RuntimeQuotaWindow,
} from '../../types/runtime'

export const WEEK_MS = 7 * 24 * 3_600_000
/** Fewer hourly readings than this since the reset say too little about the pace. */
const MIN_READINGS = 3

/** How the weekly window stands at its reset, read from its pace since the last one. */
export type WeeklyPace =
  | { kind: 'usedUp'; since: number | null }
  | { kind: 'runsOut'; at: number }
  | { kind: 'onPace'; atReset: number }
  | { kind: 'tooFew' }

/** The window the chart draws: the plan's weekly one, when the agent reports it. */
export function weeklyWindow(quota: RuntimeQuota | undefined): RuntimeQuotaWindow | null {
  if (!quota?.available) return null

  return quota.windows.find((window) => window.label === 'Weekly' && window.resetsAt) ?? null
}

/** Every hour of the last 7 days with that window's highest reading, null where none. */
export function weeklyPoints(
  series: readonly RuntimeQuotaHistorySeries[],
  runtimeId: string,
  windowId: string,
  nowMs: number,
): MetricPoint[] {
  const points = series.find((s) => s.runtimeId === runtimeId && s.windowId === windowId)?.points
  const used = new Map(points?.map((p) => [Date.parse(p.at), p.usedPercent]))

  return quotaBuckets('7d', nowMs).map((at) => ({ at, value: used.get(at) ?? null }))
}

/** Each stretch of hours nobody read. */
export function readingGaps(points: readonly MetricPoint[], end: number): MetricGap[] {
  const gaps: MetricGap[] = []

  points.forEach((point, i) => {
    if (point.value !== null) return
    const to = points[i + 1]?.at ?? end
    const last = gaps.at(-1)

    if (last?.to === point.at) last.to = to
    else gaps.push({ from: point.at, to })
  })

  return gaps
}

/** Hours spent at a limit: each hourly bucket whose busiest window was used up. A bucket
 *  nobody read is not counted, so this is never more than happened. */
export function atLimitHours(peak: readonly MetricPoint[]): number {
  return peak.filter((point) => (point.value ?? 0) >= 100).length
}

/** At the pace since the last reset, whether the window runs out before the next one. */
export function weeklyPace(
  window: RuntimeQuotaWindow,
  points: readonly MetricPoint[],
  nowMs: number,
): WeeklyPace {
  const resetsAt = Date.parse(window.resetsAt ?? '')
  const start = resetsAt - WEEK_MS
  const read = points.filter((point) => point.at >= start && point.value !== null)

  if (window.usedPercent >= 100) {
    // Where the stretch at the limit that is still going began.
    let since: number | null = null

    for (const point of [...read].reverse()) {
      if ((point.value ?? 0) < 100) break
      since = point.at
    }

    return { kind: 'usedUp', since }
  }
  if (read.length < MIN_READINGS || nowMs <= start) return { kind: 'tooFew' }
  const perMs = window.usedPercent / (nowMs - start)
  const runsOutAt = start + 100 / perMs

  return runsOutAt < resetsAt
    ? { kind: 'runsOut', at: runsOutAt }
    : { kind: 'onPace', atReset: Math.round(perMs * WEEK_MS) }
}

/** A weekday and time, e.g. "Sun 9:00 AM", in the viewer's locale. */
export const dayTime = (at: number) =>
  new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
