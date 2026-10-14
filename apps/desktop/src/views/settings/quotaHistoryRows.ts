import type { MetricPoint } from './MetricChart'
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
  /** Every bucket's highest use across the agent's windows; null where nothing was read. */
  peak: MetricPoint[]
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

/** One row per agent that reported in the range. */
export function quotaHistoryRows(
  series: RuntimeQuotaHistorySeries[],
  instances: readonly RuntimeInstance[],
  range: RuntimeQuotaHistoryRange,
  nowMs = Date.now(),
): QuotaHistoryRow[] {
  const buckets = quotaBuckets(range, nowMs)

  return instances.flatMap((instance) => {
    const used = series
      .filter((s) => s.runtimeId === instance.id)
      .map((s) => new Map(s.points.map((p) => [Date.parse(p.at), p.usedPercent])))

    if (used.length === 0) return []

    return [
      {
        instance,
        peak: buckets.map((at) => {
          const values = used.flatMap((u) => u.get(at) ?? [])

          return { at, value: values.length > 0 ? Math.max(...values) : null }
        }),
      },
    ]
  })
}
