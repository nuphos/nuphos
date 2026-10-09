import type { ChartPayload } from '../../components/agent/chartPayload'
import type {
  RuntimeInstance,
  RuntimeQuotaHistoryRange,
  RuntimeQuotaHistorySeries,
} from '../../types/runtime'

function timeLabel(iso: string, range: RuntimeQuotaHistoryRange): string {
  const at = new Date(iso)

  return range === '1d'
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit' })
}

/** One chart per usage window ("5-hour", "Weekly", …), one line per agent. A bucket
 *  with no reading stays empty rather than reading as zero. */
export function quotaHistoryCharts(
  series: RuntimeQuotaHistorySeries[],
  instances: readonly RuntimeInstance[],
  range: RuntimeQuotaHistoryRange,
): ChartPayload[] {
  const names = new Map(instances.map((instance) => [instance.id, instance.label]))
  const byLabel = new Map<string, RuntimeQuotaHistorySeries[]>()

  for (const s of series) {
    if (!names.has(s.runtimeId)) continue
    byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s])
  }

  return [...byLabel].map(([label, lines]) => {
    const used = lines.map(
      (line) => new Map(line.points.map((p) => [p.at, p.usedPercent] as const)),
    )
    const times = [...new Set(lines.flatMap((line) => line.points.map((p) => p.at)))].sort((a, b) =>
      a.localeCompare(b),
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
