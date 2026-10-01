import {
  CloudWatchLogsClient,
  DeleteRetentionPolicyCommand,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
  GetLogEventsCommand,
  PutRetentionPolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs'

import { extractAwsAccountId } from './account'
import { assumeRoleAsConnector, getEnabledRegions } from './aws'
import { collectAwsRegionalList } from './aws-errors'

import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs'

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

function mapLogGroup(g: LogGroup, region: string): AwsLogGroup | null {
  if (!g.logGroupName) return null

  return {
    name: g.logGroupName,
    arn: g.arn ?? null,
    region,
    createdAt: g.creationTime ? new Date(g.creationTime).toISOString() : null,
    retentionDays: g.retentionInDays ?? null,
    storedBytes: g.storedBytes ?? null,
    logGroupClass: g.logGroupClass ?? null,
  }
}

export async function listLogGroups(
  roleArn: string,
  opts?: { region?: string },
): Promise<AwsLogGroup[]> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) throw new Error('Invalid roleArn (cannot extract account ID)')
  const temp = await assumeRoleAsConnector(roleArn)
  const regions = await getEnabledRegions(accountId, temp)
  const target = opts?.region ? [opts.region] : regions

  return collectAwsRegionalList(target, 'logs:DescribeLogGroups', async (region) => {
    const logs = new CloudWatchLogsClient({ region, credentials: temp })
    const groups: AwsLogGroup[] = []
    let nextToken: string | undefined

    do {
      const out = await logs.send(new DescribeLogGroupsCommand({ nextToken }))

      for (const g of out.logGroups ?? []) {
        const mapped = mapLogGroup(g, region)

        if (mapped) groups.push(mapped)
      }
      nextToken = out.nextToken
    } while (nextToken)

    return groups
  })
}

const TAIL_STREAM_COUNT = 10
const TAIL_EVENTS_PER_STREAM = 100
const TAIL_MAX_EVENTS = 500

// Tail the most recent events of a log group. FilterLogEvents can only walk
// forward from a start time (so a bounded call returns the *oldest* events in
// the window, not the newest) — instead, take the streams with the latest
// activity and read each one backwards from its tail, then merge.
export async function getLogGroupEvents(
  roleArn: string,
  region: string,
  logGroupName: string,
): Promise<AwsLogGroupEvents> {
  const temp = await assumeRoleAsConnector(roleArn)
  const logs = new CloudWatchLogsClient({ region, credentials: temp })

  const streamsOut = await logs.send(
    new DescribeLogStreamsCommand({
      logGroupName,
      orderBy: 'LastEventTime',
      descending: true,
      limit: TAIL_STREAM_COUNT,
    }),
  )
  const streams = (streamsOut.logStreams ?? [])
    .map((s) => s.logStreamName)
    .filter((name): name is string => !!name)

  const perStream = await Promise.all(
    streams.map(async (logStreamName) => {
      const out = await logs.send(
        new GetLogEventsCommand({
          logGroupName,
          logStreamName,
          startFromHead: false,
          limit: TAIL_EVENTS_PER_STREAM,
        }),
      )

      return (out.events ?? []).map((e): AwsLogEvent => ({
        timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : null,
        message: e.message ?? '',
        logStreamName,
      }))
    }),
  )

  const events = perStream
    .flat()
    .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
    .slice(-TAIL_MAX_EVENTS)

  return { events, searchedStreams: streams.length }
}

export type AwsLogSearchResult = {
  events: AwsLogEvent[]
  nextToken: string | null
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

const SEARCH_PAGE_LIMIT = 1000

// Server-side log search via FilterLogEvents: bounded time window, optional
// CloudWatch filter pattern, optional single-stream scope, forward-paginated.
export async function searchLogGroupEvents(
  roleArn: string,
  region: string,
  logGroupName: string,
  opts: {
    pattern?: string
    startTimeMs?: number
    endTimeMs?: number
    logStreamName?: string
    nextToken?: string
  },
): Promise<AwsLogSearchResult> {
  const temp = await assumeRoleAsConnector(roleArn)
  const logs = new CloudWatchLogsClient({ region, credentials: temp })
  const out = await logs.send(
    new FilterLogEventsCommand({
      logGroupName,
      filterPattern: opts.pattern || undefined,
      startTime: opts.startTimeMs,
      endTime: opts.endTimeMs,
      logStreamNames: opts.logStreamName ? [opts.logStreamName] : undefined,
      nextToken: opts.nextToken || undefined,
      limit: SEARCH_PAGE_LIMIT,
    }),
  )
  const events = (out.events ?? []).map((e): AwsLogEvent => ({
    timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : null,
    message: e.message ?? '',
    logStreamName: e.logStreamName ?? '',
  }))

  return { events, nextToken: out.nextToken ?? null }
}

export async function listLogStreams(
  roleArn: string,
  region: string,
  logGroupName: string,
  opts?: { nextToken?: string },
): Promise<AwsLogStreamListing> {
  const temp = await assumeRoleAsConnector(roleArn)
  const logs = new CloudWatchLogsClient({ region, credentials: temp })
  const out = await logs.send(
    new DescribeLogStreamsCommand({
      logGroupName,
      orderBy: 'LastEventTime',
      descending: true,
      limit: 50,
      nextToken: opts?.nextToken || undefined,
    }),
  )
  const streams = (out.logStreams ?? [])
    .filter((s) => !!s.logStreamName)
    .map((s): AwsLogStream => ({
      name: s.logStreamName!,
      createdAt: s.creationTime ? new Date(s.creationTime).toISOString() : null,
      firstEventAt: s.firstEventTimestamp ? new Date(s.firstEventTimestamp).toISOString() : null,
      lastEventAt: s.lastEventTimestamp ? new Date(s.lastEventTimestamp).toISOString() : null,
    }))

  return { streams, nextToken: out.nextToken ?? null }
}

export async function setLogGroupRetention(
  roleArn: string,
  region: string,
  logGroupName: string,
  retentionDays: number | null,
): Promise<void> {
  const temp = await assumeRoleAsConnector(roleArn)
  const logs = new CloudWatchLogsClient({ region, credentials: temp })

  if (retentionDays == null) {
    await logs.send(new DeleteRetentionPolicyCommand({ logGroupName }))
  } else {
    await logs.send(new PutRetentionPolicyCommand({ logGroupName, retentionInDays: retentionDays }))
  }
}
