import { getAwsIamPermissions } from '@/lib/byos/aws-iam'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerAwsIamRoutes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  accountScoped.get('/iam-permissions', async (c) => {
    const result = await getAwsIamPermissions(c.get('awsRoleArn'))

    return c.json(result)
  })
}
