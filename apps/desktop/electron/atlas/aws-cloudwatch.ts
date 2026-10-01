import { appendQuery, call } from './client'

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

export type AwsCloudWatchMetric = {
  namespace: string
  name: string
  dimensions: Record<string, string>
}

export type AwsCloudWatchMetricListing = {
  metrics: AwsCloudWatchMetric[]
  truncated: boolean
}

export type AwsCloudWatchMetricData = {
  stat: string
  unit: string
  periodSec: number
  startTime: string
  endTime: string
  datapoints: { timestamp: string; value: number | null }[]
}

export type AwsCloudWatchMetricQuery = {
  namespace: string
  metricName: string
  dimensions: Record<string, string>
  stat: 'Average' | 'Sum' | 'Maximum' | 'Minimum'
  rangeMinutes?: number
}

export type AwsCloudWatchAlarmHistoryItem = {
  timestamp: string | null
  type: string | null
  summary: string
}

export async function listAwsCloudWatchMetrics(
  teamId: string,
  accountId: string,
  region: string,
  namespace?: string,
  metricName?: string,
  roleId?: string,
): Promise<AwsCloudWatchMetricListing> {
  const params = new URLSearchParams()

  params.set('region', region)
  if (namespace) params.set('namespace', namespace)
  if (metricName) params.set('metricName', metricName)
  if (roleId) params.set('roleId', roleId)
  const data = await call<{ metrics?: AwsCloudWatchMetric[]; truncated?: boolean }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/cloudwatch-metrics?${params.toString()}`,
  )

  return { metrics: data.metrics ?? [], truncated: data.truncated ?? false }
}

export async function getAwsCloudWatchMetricData(
  teamId: string,
  accountId: string,
  region: string,
  query: AwsCloudWatchMetricQuery,
  roleId?: string,
): Promise<AwsCloudWatchMetricData> {
  const params = new URLSearchParams()

  params.set('region', region)
  params.set('namespace', query.namespace)
  params.set('metricName', query.metricName)
  params.set('dimensions', JSON.stringify(query.dimensions))
  params.set('stat', query.stat)
  if (query.rangeMinutes != null) params.set('rangeMinutes', String(query.rangeMinutes))
  if (roleId) params.set('roleId', roleId)

  return await call<AwsCloudWatchMetricData>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/cloudwatch-metric-data?${params.toString()}`,
  )
}

export async function getAwsCloudWatchAlarmHistory(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  roleId?: string,
): Promise<AwsCloudWatchAlarmHistoryItem[]> {
  const params = new URLSearchParams()

  params.set('region', region)
  params.set('name', name)
  if (roleId) params.set('roleId', roleId)
  const data = await call<{ items: AwsCloudWatchAlarmHistoryItem[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/cloudwatch-alarms/history?${params.toString()}`,
  )

  return data.items ?? []
}

export async function listAwsCloudWatchAlarms(
  teamId: string,
  accountId: string,
  region?: string,
  roleId?: string,
): Promise<AwsCloudWatchAlarm[]> {
  const q = appendQuery('', { region, roleId })
  const data = await call<{ alarms: AwsCloudWatchAlarm[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/cloudwatch-alarms${q}`,
  )

  return data.alarms ?? []
}
