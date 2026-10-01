import type { AwsLambdaMetricSeries } from './aws-compute.ts'

export type AwsLogSearchResult = {
  events: AwsLogEvent[]
  nextToken: string | null
}

export type AwsLogSearchOptions = {
  pattern?: string
  startTime?: number
  endTime?: number
  stream?: string
  nextToken?: string
}

export type AwsLogStream = {
  name: string
  createdAt: string | null
  firstEventAt: string | null
  lastEventAt: string | null
}

export type AwsLogStreamListing = {
  streams: AwsLogStream[]
  nextToken: string | null
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

export type AwsLambdaMetricsResponse = {
  series: AwsLambdaMetricSeries[]
  periodSec: number
  startTime: string
  endTime: string
}

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

export type AwsLogGroup = {
  name: string
  arn: string | null
  region: string
  createdAt: string | null
  retentionDays: number | null
  storedBytes: number | null
  logGroupClass: string | null
}

export type AwsLogEvent = {
  timestamp: string | null
  message: string
  logStreamName: string
}

export type AwsLogGroupEvents = {
  events: AwsLogEvent[]
  searchedStreams: number
}

export type AwsCfnStack = {
  stackId: string
  stackName: string
  status: string
  statusReason: string | null
  description: string | null
  createdAt: string
  updatedAt: string | null
  region: string
  driftStatus: string | null
}
