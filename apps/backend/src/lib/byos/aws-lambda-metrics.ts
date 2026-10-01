import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'

import { assumeRoleAsConnector } from './aws'

export type AwsLambdaMetricSeries = {
  metricName: string
  stat: 'Sum' | 'Average' | 'Maximum'
  unit: string
  datapoints: { timestamp: string; value: number | null; maximum: number | null }[]
}

export type AwsLambdaMetricsResponse = {
  series: AwsLambdaMetricSeries[]
  periodSec: number
  startTime: string
  endTime: string
}

const LAMBDA_METRICS: readonly { metricName: string; stat: 'Sum' | 'Average' | 'Maximum' }[] = [
  { metricName: 'Invocations', stat: 'Sum' },
  { metricName: 'Errors', stat: 'Sum' },
  { metricName: 'Throttles', stat: 'Sum' },
  { metricName: 'Duration', stat: 'Average' },
  { metricName: 'ConcurrentExecutions', stat: 'Maximum' },
]

export async function getLambdaFunctionMetrics(
  roleArn: string,
  region: string,
  name: string,
  opts?: { rangeMinutes?: number },
): Promise<AwsLambdaMetricsResponse> {
  const temp = await assumeRoleAsConnector(roleArn)
  const cw = new CloudWatchClient({ region, credentials: temp })

  const rangeMinutes = Math.max(5, Math.min(opts?.rangeMinutes ?? 60, 1440))
  const periodSec = rangeMinutes <= 60 ? 60 : 300
  const endTime = new Date()
  const startTime = new Date(endTime.getTime() - rangeMinutes * 60_000)

  // Errors (permission denials, throttling, outages) propagate to the route so
  // the client can distinguish "query failed" from "function has no datapoints"
  // and surface the permission-denied flow.
  const series = await Promise.all(
    LAMBDA_METRICS.map(async ({ metricName, stat }) => {
      const out = await cw.send(
        new GetMetricStatisticsCommand({
          Namespace: 'AWS/Lambda',
          MetricName: metricName,
          Dimensions: [{ Name: 'FunctionName', Value: name }],
          StartTime: startTime,
          EndTime: endTime,
          Period: periodSec,
          Statistics: stat === 'Maximum' ? ['Maximum'] : [stat, 'Maximum'],
        }),
      )
      const datapoints = (out.Datapoints ?? [])
        .filter((d) => !!d.Timestamp)
        .sort((a, b) => a.Timestamp!.getTime() - b.Timestamp!.getTime())
        .map((d) => {
          const raw = stat === 'Sum' ? d.Sum : stat === 'Average' ? d.Average : d.Maximum

          return {
            timestamp: d.Timestamp!.toISOString(),
            value: typeof raw === 'number' ? raw : null,
            maximum: typeof d.Maximum === 'number' ? d.Maximum : null,
          }
        })

      return {
        metricName,
        stat,
        unit: out.Datapoints?.[0]?.Unit ?? (metricName === 'Duration' ? 'Milliseconds' : 'Count'),
        datapoints,
      } satisfies AwsLambdaMetricSeries
    }),
  )

  return {
    series,
    periodSec,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  }
}
