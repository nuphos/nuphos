import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  GetFunctionConcurrencyCommand,
  InvokeCommand,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda'

import { AppError } from '@/lib/errors'

import { extractAwsAccountId } from './account'
import { assumeRoleAsConnector, getEnabledRegions } from './aws'
import { collectAwsRegionalList } from './aws-errors'

import type { FunctionConfiguration } from '@aws-sdk/client-lambda'

export { getLambdaFunctionMetrics } from './aws-lambda-metrics'
export { listLambdaTriggers } from './aws-lambda-triggers'

export type { AwsLambdaMetricSeries, AwsLambdaMetricsResponse } from './aws-lambda-metrics'
export type {
  AwsLambdaEventSourceMapping,
  AwsLambdaPolicyTrigger,
  AwsLambdaTriggers,
} from './aws-lambda-triggers'

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

function mapFunction(f: FunctionConfiguration, region: string): AwsLambdaFunction | null {
  if (!f.FunctionName || !f.FunctionArn) return null

  return {
    name: f.FunctionName,
    arn: f.FunctionArn,
    region,
    runtime: f.Runtime ?? null,
    handler: f.Handler ?? null,
    description: f.Description || null,
    memoryMb: f.MemorySize ?? null,
    timeoutSec: f.Timeout ?? null,
    codeSizeBytes: f.CodeSize ?? 0,
    packageType: f.PackageType ?? null,
    architectures: f.Architectures ?? [],
    lastModified: f.LastModified ?? null,
  }
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

export async function getLambdaFunctionDetail(
  roleArn: string,
  region: string,
  name: string,
): Promise<AwsLambdaFunctionDetail> {
  const temp = await assumeRoleAsConnector(roleArn)
  const lambda = new LambdaClient({ region, credentials: temp })
  let out

  try {
    out = await lambda.send(new GetFunctionCommand({ FunctionName: name }))
  } catch (e) {
    if ((e as { name?: string }).name === 'ResourceNotFoundException') {
      throw new AppError(
        404,
        'lambda_function_not_found',
        `Lambda function ${name} not found in ${region}`,
      )
    }
    throw e
  }
  const cfg = out.Configuration ?? {}
  const base = mapFunction(cfg, region)

  if (!base) {
    throw new AppError(
      404,
      'lambda_function_not_found',
      `Lambda function ${name} not found in ${region}`,
    )
  }
  const concurrency = await lambda
    .send(new GetFunctionConcurrencyCommand({ FunctionName: name }))
    .then((c) => c.ReservedConcurrentExecutions ?? null)
    .catch(() => null)

  return {
    ...base,
    roleArn: cfg.Role ?? null,
    state: cfg.State ?? null,
    stateReason: cfg.StateReason ?? null,
    lastUpdateStatus: cfg.LastUpdateStatus ?? null,
    ephemeralStorageMb: cfg.EphemeralStorage?.Size ?? null,
    environment: cfg.Environment?.Variables ?? {},
    layers: (cfg.Layers ?? []).map((l) => l.Arn).filter((a): a is string => !!a),
    vpcSubnetIds: cfg.VpcConfig?.SubnetIds ?? [],
    vpcSecurityGroupIds: cfg.VpcConfig?.SecurityGroupIds ?? [],
    logGroup: cfg.LoggingConfig?.LogGroup ?? `/aws/lambda/${base.name}`,
    codeSha256: cfg.CodeSha256 ?? null,
    version: cfg.Version ?? null,
    reservedConcurrency: concurrency,
  }
}

export type AwsLambdaInvokeResult = {
  statusCode: number | null
  functionError: string | null
  executedVersion: string | null
  payload: string
  logTail: string
}

export async function invokeLambdaFunction(
  roleArn: string,
  region: string,
  name: string,
  payload: string,
): Promise<AwsLambdaInvokeResult> {
  const temp = await assumeRoleAsConnector(roleArn)
  const lambda = new LambdaClient({ region, credentials: temp })
  const out = await lambda.send(
    new InvokeCommand({
      FunctionName: name,
      InvocationType: 'RequestResponse',
      LogType: 'Tail',
      Payload: payload ? Buffer.from(payload, 'utf8') : undefined,
    }),
  )

  return {
    statusCode: out.StatusCode ?? null,
    functionError: out.FunctionError ?? null,
    executedVersion: out.ExecutedVersion ?? null,
    payload: out.Payload ? Buffer.from(out.Payload).toString('utf8') : '',
    logTail: out.LogResult ? Buffer.from(out.LogResult, 'base64').toString('utf8') : '',
  }
}

export async function updateLambdaFunctionConfig(
  roleArn: string,
  region: string,
  name: string,
  updates: {
    memoryMb?: number
    timeoutSec?: number
    environment?: Record<string, string>
  },
): Promise<void> {
  const temp = await assumeRoleAsConnector(roleArn)
  const lambda = new LambdaClient({ region, credentials: temp })

  await lambda.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: name,
      MemorySize: updates.memoryMb,
      Timeout: updates.timeoutSec,
      Environment: updates.environment ? { Variables: updates.environment } : undefined,
    }),
  )
}

export async function listLambdaFunctions(
  roleArn: string,
  opts?: { region?: string },
): Promise<AwsLambdaFunction[]> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) throw new Error('Invalid roleArn (cannot extract account ID)')
  const temp = await assumeRoleAsConnector(roleArn)
  const regions = await getEnabledRegions(accountId, temp)
  const target = opts?.region ? [opts.region] : regions

  return collectAwsRegionalList(target, 'lambda:ListFunctions', async (region) => {
    const lambda = new LambdaClient({ region, credentials: temp })
    const functions: AwsLambdaFunction[] = []
    let marker: string | undefined

    do {
      const out = await lambda.send(new ListFunctionsCommand({ Marker: marker }))

      for (const f of out.Functions ?? []) {
        const mapped = mapFunction(f, region)

        if (mapped) functions.push(mapped)
      }
      marker = out.NextMarker
    } while (marker)

    return functions
  })
}
