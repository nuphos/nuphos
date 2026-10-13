import type { MetricGap, MetricPoint } from './MetricChart'
import type {
  RuntimeInstance,
  RuntimeQuotaHistoryRange,
  RuntimeQuotaHistorySeries,
} from '../../types/runtime'

// Mirrors the backend's buckets, which floor to whole multiples of the bin size in UTC.
export const QUOTA_HISTORY_RANGES: Record<
  RuntimeQuotaHistoryRange,
  { label: string; hours: number; bucketMinutes: number; bucketLabel: string }
> = {
  '1d': { label: '24h', hours: 24, bucketMinutes: 10, bucketLabel: '10 minutes' },
  '7d': { label: '7d', hours: 24 * 7, bucketMinutes: 60, bucketLabel: 'hour' },
  '30d': { label: '30d', hours: 24 * 30, bucketMinutes: 360, bucketLabel: '6 hours' },
}

export type QuotaHistoryRow = {
  instance: RuntimeInstance
  windows: { id: string; label: string; data: MetricPoint[] }[]
  /** Stretches of two or more buckets in which nothing at all was read for this agent. */
  gaps: MetricGap[]
}

/** Every bucket of the range, so a stretch nobody read stays on the axis. */
export function quotaBuckets(range: RuntimeQuotaHistoryRange, nowMs: number): number[] {
  const { hours, bucketMinutes } = QUOTA_HISTORY_RANGES[range]
  const step = bucketMinutes * 60_000
  const floor = (ms: number) => Math.floor(ms / step) * step
  const buckets: number[] = []

  for (let at = floor(nowMs - hours * 3_600_000); at <= floor(nowMs); at += step) buckets.push(at)

  return buckets
}

/** A single empty bucket between two readings is a missed poll, not a break: the line
 *  runs straight through it and it gets no band. */
function bridgedBuckets(buckets: number[], read: Set<number>): Set<number> {
  return new Set(
    buckets.filter(
      (at, i) => !read.has(at) && read.has(buckets[i - 1] ?? -1) && read.has(buckets[i + 1] ?? -1),
    ),
  )
}

/** Runs of empty buckets, merged, each ending where the next bucket starts. */
function gapsOf(
  buckets: number[],
  read: Set<number>,
  bridged: Set<number>,
  step: number,
  nowMs: number,
): MetricGap[] {
  const gaps: MetricGap[] = []

  for (const at of buckets) {
    if (read.has(at) || bridged.has(at)) continue
    const last = gaps.at(-1)
    const to = Math.min(at + step, nowMs)

    if (last?.to === at) last.to = to
    else gaps.push({ from: at, to })
  }

  return gaps
}

/** One row per agent that reported in the range, its usage windows sorted by name. */
export function quotaHistoryRows(
  series: RuntimeQuotaHistorySeries[],
  instances: readonly RuntimeInstance[],
  range: RuntimeQuotaHistoryRange,
  nowMs = Date.now(),
): QuotaHistoryRow[] {
  const buckets = quotaBuckets(range, nowMs)
  const step = QUOTA_HISTORY_RANGES[range].bucketMinutes * 60_000

  return instances.flatMap((instance) => {
    const own = series
      .filter((s) => s.runtimeId === instance.id)
      .sort((a, b) => a.label.localeCompare(b.label))

    if (own.length === 0) return []
    const read = new Set<number>()
    const used = own.map((s) => new Map(s.points.map((p) => [Date.parse(p.at), p.usedPercent])))

    for (const values of used) for (const at of values.keys()) read.add(at)
    const bridged = bridgedBuckets(buckets, read)
    const drawn = buckets.filter((at) => !bridged.has(at))

    return [
      {
        instance,
        windows: own.map((s, i) => ({
          id: s.windowId,
          label: s.label,
          data: drawn.map((at) => ({ at, value: used[i]?.get(at) ?? null })),
        })),
        gaps: gapsOf(buckets, read, bridged, step, nowMs),
      },
    ]
  })
}
