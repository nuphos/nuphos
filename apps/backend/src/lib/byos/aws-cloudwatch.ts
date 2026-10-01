import {
  CloudWatchClient,
  DescribeAlarmHistoryCommand,
  DescribeAlarmsCommand,
  GetMetricStatisticsCommand,
  ListMetricsCommand,
} from '@aws-sdk/client-cloudwatch'

import { extractAwsAccountId } from './account'
import { assumeRoleAsConnector, getEnabledRegions } from './aws'
import { collectAwsRegionalList } from './aws-errors'

import type { MetricAlarm, CompositeAlarm } from '@aws-sdk/client-cloudwatch'

export type AwsCloudWatchAlarm = {
  name: string
  arn: string
  region: string
  kind: 'metric' | 'composite'
  state: string
  stateReason: string | null
  stateUpdatedAt: string | null
  metricName: string | null
  namespace: string | null
  statistic: string | null
  comparisonOperator: string | null
  threshold: number | null
  evaluationPeriods: number | null
  periodSec: number | null
  actionsEnabled: boolean
  description: string | null
  dimensions: Record<string, string>
}

function alarmDimensions(a: MetricAlarm): Record<string, string> {
  const out: Record<string, string> = {}

  for (const d of a.Dimensions ?? []) {
    if (d.Name && d.Value !== undefined) out[d.Name] = d.Value
  }

  return out
}

function mapMetricAlarm(a: MetricAlarm, region: string): AwsCloudWatchAlarm | null {
  if (!a.AlarmName || !a.AlarmArn) return null

  return {
    dimensions: alarmDimensions(a),
    name: a.AlarmName,
    arn: a.AlarmArn,
    region,
    kind: 'metric',
    state: a.StateValue ?? 'INSUFFICIENT_DATA',
    stateReason: a.StateReason ?? null,
    stateUpdatedAt: a.StateUpdatedTimestamp ? a.StateUpdatedTimestamp.toISOString() : null,
    metricName: a.MetricName ?? null,
    namespace: a.Namespace ?? null,
    statistic: a.Statistic ?? a.ExtendedStatistic ?? null,
    comparisonOperator: a.ComparisonOperator ?? null,
    threshold: a.Threshold ?? null,
    evaluationPeriods: a.EvaluationPeriods ?? null,
    periodSec: a.Period ?? null,
    actionsEnabled: a.ActionsEnabled ?? false,
    description: a.AlarmDescription ?? null,
  }
}

function mapCompositeAlarm(a: CompositeAlarm, region: string): AwsCloudWatchAlarm | null {
  if (!a.AlarmName || !a.AlarmArn) return null

  return {
    dimensions: {},
    name: a.AlarmName,
    arn: a.AlarmArn,
    region,
    kind: 'composite',
    state: a.StateValue ?? 'INSUFFICIENT_DATA',
    stateReason: a.StateReason ?? null,
    stateUpdatedAt: a.StateUpdatedTimestamp ? a.StateUpdatedTimestamp.toISOString() : null,
    metricName: null,
    namespace: null,
    statistic: null,
    comparisonOperator: null,
    threshold: null,
    evaluationPeriods: null,
    periodSec: null,
    actionsEnabled: a.ActionsEnabled ?? false,
    description: a.AlarmDescription ?? null,
  }
}

export async function listCloudWatchAlarms(
  roleArn: string,
  opts?: { region?: string },
): Promise<AwsCloudWatchAlarm[]> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) throw new Error('Invalid roleArn (cannot extract account ID)')
  const temp = await assumeRoleAsConnector(roleArn)
  const regions = await getEnabledRegions(accountId, temp)
  const target = opts?.region ? [opts.region] : regions

  return collectAwsRegionalList(target, 'cloudwatch:DescribeAlarms', async (region) => {
    const cw = new CloudWatchClient({ region, credentials: temp })
    const alarms: AwsCloudWatchAlarm[] = []
    let nextToken: string | undefined

    do {
      const out = await cw.send(
        new DescribeAlarmsCommand({
          AlarmTypes: ['MetricAlarm', 'CompositeAlarm'],
          NextToken: nextToken,
        }),
      )

      for (const a of out.MetricAlarms ?? []) {
        const mapped = mapMetricAlarm(a, region)

        if (mapped) alarms.push(mapped)
      }
      for (const a of out.CompositeAlarms ?? []) {
        const mapped = mapCompositeAlarm(a, region)

        if (mapped) alarms.push(mapped)
      }
      nextToken = out.NextToken
    } while (nextToken)

    return alarms
  })
}

export type AwsCloudWatchMetric = {
  namespace: string
  name: string
  dimensions: Record<string, string>
}

const METRIC_LIST_MAX = 1500

export type AwsCloudWatchMetricListing = {
  metrics: AwsCloudWatchMetric[]
  // True when the sweep hit METRIC_LIST_MAX with pages remaining — callers
  // should narrow with a namespace/metricName filter for a complete listing.
  truncated: boolean
}

export async function listCloudWatchMetrics(
  roleArn: string,
  region: string,
  opts?: { namespace?: string; metricName?: string },
): Promise<AwsCloudWatchMetricListing> {
  const temp = await assumeRoleAsConnector(roleArn)
  const cw = new CloudWatchClient({ region, credentials: temp })
  const metrics: AwsCloudWatchMetric[] = []
  let nextToken: string | undefined

  do {
    const out = await cw.send(
      new ListMetricsCommand({
        Namespace: opts?.namespace || undefined,
        MetricName: opts?.metricName || undefined,
        NextToken: nextToken,
      }),
    )

    for (const m of out.Metrics ?? []) {
      if (!m.Namespace || !m.MetricName) continue
      const dims: Record<string, string> = {}

      for (const d of m.Dimensions ?? []) {
        if (d.Name && d.Value !== undefined) dims[d.Name] = d.Value
      }
      metrics.push({ namespace: m.Namespace, name: m.MetricName, dimensions: dims })
    }
    nextToken = out.NextToken
  } while (nextToken && metrics.length < METRIC_LIST_MAX)

  return { metrics, truncated: !!nextToken }
}

export type AwsCloudWatchMetricData = {
  stat: string
  unit: string
  periodSec: number
  startTime: string
  endTime: string
  datapoints: { timestamp: string; value: number | null }[]
}

export async function getCloudWatchMetricData(
  roleArn: string,
  region: string,
  query: {
    namespace: string
    metricName: string
    dimensions: Record<string, string>
    stat: 'Average' | 'Sum' | 'Maximum' | 'Minimum'
    rangeMinutes?: number
  },
): Promise<AwsCloudWatchMetricData> {
  const temp = await assumeRoleAsConnector(roleArn)
  const cw = new CloudWatchClient({ region, credentials: temp })

  const rangeMinutes = Math.max(5, Math.min(query.rangeMinutes ?? 60, 10080))
  let periodSec: number

  if (rangeMinutes <= 60) periodSec = 60
  else if (rangeMinutes <= 1440) periodSec = 300
  else periodSec = 3600
  const endTime = new Date()
  const startTime = new Date(endTime.getTime() - rangeMinutes * 60_000)

  const out = await cw.send(
    new GetMetricStatisticsCommand({
      Namespace: query.namespace,
      MetricName: query.metricName,
      Dimensions: Object.entries(query.dimensions).map(([Name, Value]) => ({ Name, Value })),
      StartTime: startTime,
      EndTime: endTime,
      Period: periodSec,
      Statistics: [query.stat],
    }),
  )

  const datapoints = (out.Datapoints ?? [])
    .filter((d) => !!d.Timestamp)
    .sort((a, b) => a.Timestamp!.getTime() - b.Timestamp!.getTime())
    .map((d) => {
      const v =
        query.stat === 'Average'
          ? d.Average
          : query.stat === 'Sum'
            ? d.Sum
            : query.stat === 'Maximum'
              ? d.Maximum
              : d.Minimum

      return {
        timestamp: d.Timestamp!.toISOString(),
        value: typeof v === 'number' ? v : null,
      }
    })

  return {
    stat: query.stat,
    unit: out.Datapoints?.[0]?.Unit ?? 'None',
    periodSec,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    datapoints,
  }
}

export type AwsCloudWatchAlarmHistoryItem = {
  timestamp: string | null
  type: string | null
  summary: string
}

export async function getCloudWatchAlarmHistory(
  roleArn: string,
  region: string,
  alarmName: string,
): Promise<AwsCloudWatchAlarmHistoryItem[]> {
  const temp = await assumeRoleAsConnector(roleArn)
  const cw = new CloudWatchClient({ region, credentials: temp })
  const out = await cw.send(
    new DescribeAlarmHistoryCommand({
      AlarmName: alarmName,
      MaxRecords: 50,
      ScanBy: 'TimestampDescending',
    }),
  )

  return (out.AlarmHistoryItems ?? []).map((h) => ({
    timestamp: h.Timestamp ? h.Timestamp.toISOString() : null,
    type: h.HistoryItemType ?? null,
    summary: h.HistorySummary ?? '',
  }))
}
