import { appendQuery, call, withAwsRole } from './client'

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

export type AwsLogSearchOptions = {
  pattern?: string
  startTime?: number
  endTime?: number
  stream?: string
  nextToken?: string
}

export async function searchAwsLogGroupEvents(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  options: AwsLogSearchOptions,
  roleId?: string,
): Promise<AwsLogSearchResult> {
  const params = new URLSearchParams()

  params.set('region', region)
  params.set('name', name)
  if (options.pattern) params.set('pattern', options.pattern)
  if (options.startTime != null) params.set('startTime', String(options.startTime))
  if (options.endTime != null) params.set('endTime', String(options.endTime))
  if (options.stream) params.set('stream', options.stream)
  if (options.nextToken) params.set('nextToken', options.nextToken)
  if (roleId) params.set('roleId', roleId)

  return await call<AwsLogSearchResult>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/log-groups/search?${params.toString()}`,
  )
}

export async function listAwsLogStreams(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  nextToken?: string,
  roleId?: string,
): Promise<AwsLogStreamListing> {
  const params = new URLSearchParams()

  params.set('region', region)
  params.set('name', name)
  if (nextToken) params.set('nextToken', nextToken)
  if (roleId) params.set('roleId', roleId)

  return await call<AwsLogStreamListing>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/log-groups/streams?${params.toString()}`,
  )
}

export async function setAwsLogGroupRetention(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  retentionDays: number | null,
  roleId?: string,
): Promise<void> {
  await call<void>(
    'PUT',
    withAwsRole(`/teams/${teamId}/aws-accounts/${accountId}/log-groups/retention`, roleId),
    { region, name, retentionDays },
  )
}

export async function listAwsLogGroups(
  teamId: string,
  accountId: string,
  region?: string,
  roleId?: string,
): Promise<AwsLogGroup[]> {
  const q = appendQuery('', { region, roleId })
  const data = await call<{ logGroups: AwsLogGroup[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/log-groups${q}`,
  )

  return data.logGroups ?? []
}

export async function getAwsLogGroupEvents(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  roleId?: string,
): Promise<AwsLogGroupEvents> {
  const params = new URLSearchParams()

  params.set('region', region)
  params.set('name', name)
  if (roleId) params.set('roleId', roleId)

  return await call<AwsLogGroupEvents>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/log-groups/events?${params.toString()}`,
  )
}
