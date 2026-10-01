import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'

import { assumeRoleAsConnector } from './aws'

export type AwsEcsMetricSeries = {
  metricName: string
  unit: string
  datapoints: { timestamp: string; average: number | null; maximum: number | null }[]
}

export type AwsEcsClusterMetricsResponse = {
  series: AwsEcsMetricSeries[]
  periodSec: number
  startTime: string
  endTime: string
}

const CLUSTER_METRIC_NAMES = [
  'CPUUtilization',
  'MemoryUtilization',
  'CPUReservation',
  'MemoryReservation',
] as const

export async function getEcsClusterMetrics(
  roleArn: string,
  region: string,
  clusterName: string,
  opts?: { rangeMinutes?: number; periodSec?: number },
): Promise<AwsEcsClusterMetricsResponse> {
  const temp = await assumeRoleAsConnector(roleArn)
  const cw = new CloudWatchClient({ region, credentials: temp })

  const rangeMinutes = Math.max(5, Math.min(opts?.rangeMinutes ?? 60, 1440))
  const periodSec = opts?.periodSec ?? (rangeMinutes <= 60 ? 60 : 300)
  const endTime = new Date()
  const startTime = new Date(endTime.getTime() - rangeMinutes * 60_000)

  const series = await Promise.all(
    CLUSTER_METRIC_NAMES.map(async (metricName) => {
      try {
        const out = await cw.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/ECS',
            MetricName: metricName,
            Dimensions: [{ Name: 'ClusterName', Value: clusterName }],
            StartTime: startTime,
            EndTime: endTime,
            Period: periodSec,
            Statistics: ['Average', 'Maximum'],
          }),
        )
        const datapoints = (out.Datapoints ?? [])
          .filter((d) => !!d.Timestamp)
          .sort((a, b) => a.Timestamp!.getTime() - b.Timestamp!.getTime())
          .map((d) => ({
            timestamp: d.Timestamp!.toISOString(),
            average: typeof d.Average === 'number' ? d.Average : null,
            maximum: typeof d.Maximum === 'number' ? d.Maximum : null,
          }))

        return {
          metricName,
          unit: out.Datapoints?.[0]?.Unit ?? 'Percent',
          datapoints,
        } satisfies AwsEcsMetricSeries
      } catch {
        return {
          metricName,
          unit: 'Percent',
          datapoints: [],
        } satisfies AwsEcsMetricSeries
      }
    }),
  )

  return {
    series,
    periodSec,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  }
}
