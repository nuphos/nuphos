import type { ChartPayload } from '../../components/agent/chartPayload'
import type {
  RuntimeInstance,
  RuntimeQuotaHistoryRange,
  RuntimeQuotaHistorySeries,
} from '../../types/runtime'

// Mirrors the backend's buckets, which floor to whole multiples of the bin size in UTC.
const RANGES: Record<RuntimeQuotaHistoryRange, { hours: number; bucketMinutes: number }> = {
  '1d': { hours: 24, bucketMinutes: 10 },
  '7d': { hours: 24 * 7, bucketMinutes: 60 },
  '30d': { hours: 24 * 30, bucketMinutes: 360 },
}

/** Every bucket of the range, so an hour nobody read the usage stays on the axis. */
function bucketTimes(range: RuntimeQuotaHistoryRange, nowMs: number): string[] {
  const { hours, bucketMinutes } = RANGES[range]
  const step = bucketMinutes * 60_000
  const floor = (ms: number) => Math.floor(ms / step) * step
  const times: string[] = []

  for (let at = floor(nowMs - hours * 3_600_000); at <= floor(nowMs); at += step)
    times.push(new Date(at).toISOString())

  return times
}

function timeLabel(iso: string, range: RuntimeQuotaHistoryRange): string {
  const at = new Date(iso)

  return range === '1d'
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit' })
}

/** One chart per usage window ("5-hour", "Weekly", …), one line per agent. A bucket
 *  with no reading is a gap rather than a zero, and is never dropped from the axis. */
export function quotaHistoryCharts(
  series: RuntimeQuotaHistorySeries[],
  instances: readonly RuntimeInstance[],
  range: RuntimeQuotaHistoryRange,
  nowMs = Date.now(),
): ChartPayload[] {
  const times = bucketTimes(range, nowMs)
  const names = new Map(instances.map((instance) => [instance.id, instance.label]))
  const byLabel = new Map<string, RuntimeQuotaHistorySeries[]>()

  for (const s of series) {
    if (!names.has(s.runtimeId)) continue
    byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s])
  }

  // Sorted by name so a chart keeps its place whichever order the API answers in.
  return [...byLabel]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, lines]) => {
      const used = lines.map(
        (line) => new Map(line.points.map((p) => [p.at, p.usedPercent] as const)),
      )

      return {
        type: 'line',
        title: label,
        xKey: 'time',
        series: lines.map((line) => ({ key: line.runtimeId, label: names.get(line.runtimeId) })),
        data: times.map((at) => ({
          time: timeLabel(at, range),
          ...Object.fromEntries(lines.map((line, i) => [line.runtimeId, used[i]?.get(at) ?? null])),
        })),
      }
    })
}
