import {
  CloudFormationClient,
  ListStacksCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation'

import { extractAwsAccountId } from './account'
import { assumeRoleAsConnector, getEnabledRegions } from './aws'
import { collectAwsRegionalList } from './aws-errors'

import type { StackSummary } from '@aws-sdk/client-cloudformation'

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

function mapStack(s: StackSummary, region: string): AwsCfnStack | null {
  if (!s.StackId || !s.StackName || !s.CreationTime) return null

  return {
    stackId: s.StackId,
    stackName: s.StackName,
    status: s.StackStatus ?? 'UNKNOWN',
    statusReason: s.StackStatusReason ?? null,
    description: s.TemplateDescription ?? null,
    createdAt: s.CreationTime.toISOString(),
    updatedAt: s.LastUpdatedTime ? s.LastUpdatedTime.toISOString() : null,
    region,
    driftStatus: s.DriftInformation?.StackDriftStatus ?? null,
  }
}

export async function listCfnStacks(
  roleArn: string,
  opts?: { region?: string },
): Promise<AwsCfnStack[]> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) throw new Error('Invalid roleArn (cannot extract account ID)')
  const temp = await assumeRoleAsConnector(roleArn)
  const regions = await getEnabledRegions(accountId, temp)
  const target = opts?.region ? [opts.region] : regions

  return collectAwsRegionalList(target, 'cloudformation:ListStacks', async (region) => {
    const cfn = new CloudFormationClient({ region, credentials: temp })
    const stacks: AwsCfnStack[] = []
    let nextToken: string | undefined

    do {
      const out = await cfn.send(
        new ListStacksCommand({
          StackStatusFilter: Object.values(StackStatus).filter(
            (s) => s !== StackStatus.DELETE_COMPLETE,
          ),
          NextToken: nextToken,
        }),
      )

      for (const summary of out.StackSummaries ?? []) {
        const mapped = mapStack(summary, region)

        if (mapped) stacks.push(mapped)
      }
      nextToken = out.NextToken
    } while (nextToken)

    return stacks
  })
}
