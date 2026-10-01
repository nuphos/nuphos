import { ECSClient } from '@aws-sdk/client-ecs'

import { assumeRoleAsConnector } from './aws'

export async function ecsClientFor(roleArn: string, region: string): Promise<ECSClient> {
  const temp = await assumeRoleAsConnector(roleArn)

  return new ECSClient({ region, credentials: temp })
}
