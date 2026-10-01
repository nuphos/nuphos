import { appendQuery, call, withAwsRole } from './client'

export type AwsLambdaFunction = {
  name: string
  arn: string
  region: string
  runtime: string | null
  handler: string | null
  description: string | null
  memoryMb: number | null
  timeoutSec: number | null
  codeSizeBytes: number
  packageType: string | null
  architectures: string[]
  lastModified: string | null
}

export type AwsLambdaFunctionDetail = AwsLambdaFunction & {
  roleArn: string | null
  state: string | null
  stateReason: string | null
  lastUpdateStatus: string | null
  ephemeralStorageMb: number | null
  environment: Record<string, string>
  layers: string[]
  vpcSubnetIds: string[]
  vpcSecurityGroupIds: string[]
  logGroup: string
  codeSha256: string | null
  version: string | null
  reservedConcurrency: number | null
}

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

export type AwsLambdaInvokeResult = {
  statusCode: number | null
  functionError: string | null
  executedVersion: string | null
  payload: string
  logTail: string
}

export type AwsLambdaEventSourceMapping = {
  uuid: string
  eventSourceArn: string | null
  state: string | null
  batchSize: number | null
  lastModified: string | null
}

export type AwsLambdaPolicyTrigger = {
  principal: string
  sourceArn: string | null
  statementId: string | null
}

export type AwsLambdaTriggers = {
  eventSourceMappings: AwsLambdaEventSourceMapping[]
  policyTriggers: AwsLambdaPolicyTrigger[]
}

export async function invokeAwsLambdaFunction(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  payload: string,
  roleId?: string,
): Promise<AwsLambdaInvokeResult> {
  return await call<AwsLambdaInvokeResult>(
    'POST',
    withAwsRole(
      `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function/invoke`,
      roleId,
    ),
    { region, name, payload },
  )
}

export async function updateAwsLambdaFunctionConfig(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  updates: { memoryMb?: number; timeoutSec?: number; environment?: Record<string, string> },
  roleId?: string,
): Promise<void> {
  await call<void>(
    'PATCH',
    withAwsRole(
      `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function/config`,
      roleId,
    ),
    { region, name, ...updates },
  )
}

export async function getAwsLambdaTriggers(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  roleId?: string,
): Promise<AwsLambdaTriggers> {
  const params = new URLSearchParams()

  params.set('region', region)
  params.set('name', name)
  if (roleId) params.set('roleId', roleId)

  return await call<AwsLambdaTriggers>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function/triggers?${params.toString()}`,
  )
}

export async function getAwsLambdaFunctionDetail(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  roleId?: string,
): Promise<AwsLambdaFunctionDetail> {
  const params = new URLSearchParams()

  params.set('region', region)
  params.set('name', name)
  if (roleId) params.set('roleId', roleId)

  return await call<AwsLambdaFunctionDetail>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function?${params.toString()}`,
  )
}

export async function getAwsLambdaFunctionMetrics(
  teamId: string,
  accountId: string,
  region: string,
  name: string,
  rangeMinutes?: number,
  roleId?: string,
): Promise<AwsLambdaMetricsResponse> {
  const params = new URLSearchParams()

  params.set('region', region)
  params.set('name', name)
  if (rangeMinutes != null) params.set('rangeMinutes', String(rangeMinutes))
  if (roleId) params.set('roleId', roleId)

  return await call<AwsLambdaMetricsResponse>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions/function/metrics?${params.toString()}`,
  )
}

export async function listAwsLambdaFunctions(
  teamId: string,
  accountId: string,
  region?: string,
  roleId?: string,
): Promise<AwsLambdaFunction[]> {
  const q = appendQuery('', { region, roleId })
  const data = await call<{ functions: AwsLambdaFunction[] }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/lambda-functions${q}`,
  )

  return data.functions ?? []
}
