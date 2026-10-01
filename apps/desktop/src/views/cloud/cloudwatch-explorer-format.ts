import type { DataFrame } from '../../grafana/types'
import type { AwsCloudWatchMetric, AwsCloudWatchMetricData } from '../../types'

export function cloudWatchNamespaces(metrics: AwsCloudWatchMetric[] | null): string[] {
  const set = new Set<string>()

  for (const m of metrics ?? []) set.add(m.namespace)

  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function cloudWatchMetricNames(source: AwsCloudWatchMetric[], namespace: string): string[] {
  if (!namespace) return []
  const set = new Set<string>()

  for (const m of source) {
    if (m.namespace === namespace) set.add(m.name)
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function cloudWatchSeriesFrames(
  seriesData: { label: string; data: AwsCloudWatchMetricData }[] | null,
): DataFrame[] {
  return (seriesData ?? []).map((s, i) => ({
    refId: `m${String(i)}`,
    name: s.label,
    fields: [
      {
        name: 'time',
        type: 'time' as const,
        values: s.data.datapoints.map((p) => Date.parse(p.timestamp)),
      },
      {
        name: s.label,
        type: 'number' as const,
        values: s.data.datapoints.map((p) => p.value),
      },
    ],
  }))
}
