import {
  LambdaClient,
  GetPolicyCommand,
  ListEventSourceMappingsCommand,
} from '@aws-sdk/client-lambda'

import { assumeRoleAsConnector } from './aws'

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

// Triggers come from two places: poll-based sources (SQS/Kinesis/DynamoDB) are
// event source mappings; push-based sources (API Gateway, S3, EventBridge…)
// only show up as principals in the function's resource policy.
export async function listLambdaTriggers(
  roleArn: string,
  region: string,
  name: string,
): Promise<AwsLambdaTriggers> {
  const temp = await assumeRoleAsConnector(roleArn)
  const lambda = new LambdaClient({ region, credentials: temp })

  const mappings: AwsLambdaEventSourceMapping[] = []
  let marker: string | undefined

  do {
    const out = await lambda.send(
      new ListEventSourceMappingsCommand({ FunctionName: name, Marker: marker }),
    )

    for (const m of out.EventSourceMappings ?? []) {
      if (!m.UUID) continue
      mappings.push({
        uuid: m.UUID,
        eventSourceArn: m.EventSourceArn ?? null,
        state: m.State ?? null,
        batchSize: m.BatchSize ?? null,
        lastModified: m.LastModified ? new Date(m.LastModified).toISOString() : null,
      })
    }
    marker = out.NextMarker
  } while (marker)

  let policyTriggers: AwsLambdaPolicyTrigger[] = []

  try {
    const out = await lambda.send(new GetPolicyCommand({ FunctionName: name }))

    if (out.Policy) {
      const doc = JSON.parse(out.Policy) as {
        Statement?: {
          Sid?: string
          Principal?: { Service?: string; AWS?: string } | string
          Condition?: { ArnLike?: Record<string, string>; ArnEquals?: Record<string, string> }
        }[]
      }

      policyTriggers = (doc.Statement ?? []).map((s) => {
        const principal =
          typeof s.Principal === 'string'
            ? s.Principal
            : (s.Principal?.Service ?? s.Principal?.AWS ?? 'unknown')
        const arnCond = { ...s.Condition?.ArnLike, ...s.Condition?.ArnEquals }
        const sourceArn = Object.values(arnCond)[0] ?? null

        return { principal, sourceArn, statementId: s.Sid ?? null }
      })
    }
  } catch (e) {
    // No resource policy attached is the common case, not an error.
    if ((e as { name?: string }).name !== 'ResourceNotFoundException') throw e
  }

  return { eventSourceMappings: mappings, policyTriggers }
}
