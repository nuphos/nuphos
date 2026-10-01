import { appendQuery, buildAtlasError, call, withAwsRole } from './client'

import type { Cluster } from './clusters'

export type Vpc = {
  id: string
  name?: string
  cidr?: string
  region?: string
  state?: string
}

export type NaclEntry = {
  ruleNumber: number
  ruleAction: 'allow' | 'deny'
  egress: boolean
  protocol: string
  cidrBlock?: string
  ipv6CidrBlock?: string
  portRange?: { from: number; to: number }
}

export type Nacl = {
  id: string
  vpcId: string
  region: string
  isDefault?: boolean
  entries?: NaclEntry[]
  associations?: { subnetId: string }[]
}

export type AwsListError = {
  region?: string
  message?: unknown
}

function messageFromAwsListError(error: AwsListError | undefined): string {
  return typeof error?.message === 'string' ? error.message : 'AWS returned an error'
}

function awsOperationFromMessage(message: string): string | undefined {
  return /\b([a-z][a-z0-9-]*:[A-Z*][A-Za-z0-9*]*)\b/.exec(message)?.[1]
}

export function buildAwsListError(resource: string, errors: AwsListError[]): Error {
  const first = errors[0]
  const message = messageFromAwsListError(first)
  const operation = errors
    .map((error) => messageFromAwsListError(error))
    .map(awsOperationFromMessage)
    .find((op): op is string => Boolean(op))

  if (operation) {
    return buildAtlasError(
      `The selected AWS role does not have permission to ${operation}.`,
      'aws_role_permission_denied',
      {
        provider: 'aws',
        operation,
        regions: errors
          .map((error) => error.region)
          .filter((region): region is string => Boolean(region)),
        upstreamMessage: message,
      },
    )
  }

  const where = first?.region ? ` in ${first.region}` : ''

  return new Error(`Cannot list ${resource}${where}: ${message}`)
}

type AwsRawVpc = {
  id: string
  region: string
  cidrBlock: string
  isDefault: boolean
  state: string
  tags?: Record<string, string>
}

function mapAwsVpc(v: AwsRawVpc): Vpc {
  return {
    id: v.id,
    name: v.tags?.Name,
    cidr: v.cidrBlock,
    region: v.region,
    state: v.state,
  }
}

export async function listAwsVpcs(
  teamId: string,
  accountId: string,
  region?: string,
  roleId?: string,
): Promise<Vpc[]> {
  const q = appendQuery('', { region, roleId })
  const data = await call<{ vpcs: AwsRawVpc[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/vpcs${q}`,
  )

  return (data.vpcs ?? []).map(mapAwsVpc)
}

export async function listAwsNacls(
  teamId: string,
  accountId: string,
  filters: { region?: string; vpcId?: string; roleId?: string } = {},
): Promise<Nacl[]> {
  const params = new URLSearchParams()

  if (filters.region) params.set('region', filters.region)
  if (filters.vpcId) params.set('vpcId', filters.vpcId)
  if (filters.roleId) params.set('roleId', filters.roleId)
  const q = params.toString() ? `?${String(params)}` : ''
  const data = await call<{ nacls: Nacl[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/nacls${q}`,
  )

  return data.nacls ?? []
}

export async function listAwsClusters(
  teamId: string,
  accountId: string,
  roleId?: string,
): Promise<Cluster[]> {
  const data = await call<{ clusters: Cluster[] }>(
    'GET',
    withAwsRole(`/teams/${teamId}/aws-accounts/${accountId}/clusters`, roleId),
  )

  return data.clusters ?? []
}
