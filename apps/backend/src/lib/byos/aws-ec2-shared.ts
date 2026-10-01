import { extractAwsAccountId } from './account'
import { assumeRoleAsConnector, getEnabledRegions } from './aws'

import type { TempCredentials } from './aws'
import type { Vpc } from '@aws-sdk/client-ec2'

export type AwsEc2Instance = {
  instanceId: string
  instanceType: string
  state: string
  region: string
  availabilityZone: string
  publicIp: string | null
  privateIp: string | null
  launchTime: string | null
  platform: string | null
  imageId: string | null
  tags: Record<string, string>
}

export function tagsToRecord(tags: Vpc['Tags']): Record<string, string> {
  const out: Record<string, string> = {}

  for (const t of tags ?? []) {
    if (t.Key && t.Value !== undefined) out[t.Key] = t.Value
  }

  return out
}

export async function setupForRole(
  roleArn: string,
): Promise<{ accountId: string; temp: TempCredentials; regions: string[] }> {
  const accountId = extractAwsAccountId(roleArn)

  if (!accountId) throw new Error('Invalid roleArn (cannot extract account ID)')
  const temp = await assumeRoleAsConnector(roleArn)
  const regions = await getEnabledRegions(accountId, temp)

  return { accountId, temp, regions }
}
