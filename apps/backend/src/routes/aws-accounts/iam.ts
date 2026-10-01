import { config } from '@/config'
import { assumeRoleAsConnector } from '@/lib/byos/aws'
import { getAwsIamPermissions } from '@/lib/byos/aws-iam'
import { AppError } from '@/lib/errors'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerAwsIamRoutes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  accountScoped.get('/iam-permissions', async (c) => {
    const result = await getAwsIamPermissions(c.get('awsRoleArn'))

    return c.json(result)
  })

  accountScoped.get('/credentials', async (c) => {
    // Permission-admin roles hold IAM-write (escalation) power, so their keys must
    // NEVER be exported here — not even to administrators. Admins edit IAM only
    // through the scoped attach/detach endpoints below, which assume the role on
    // the backend; the credentials themselves never leave. Handing them out would
    // put a self-escalation credential into any caller's hands — including the
    // agent sandbox, which authenticates as the (admin) user.
    if (c.get('awsBinding').purpose === 'permission-admin') {
      throw new AppError(
        403,
        'permission_admin_no_token_export',
        'Credentials for a permission-admin role cannot be exported; remove this retired connection and connect an ordinary role instead',
      )
    }
    const temp = await assumeRoleAsConnector(c.get('awsRoleArn'))
    const expiresAt = new Date(Date.now() + config.byos.aws.sessionDurationSec * 1000)

    c.header('X-Credentials-Expires-At', expiresAt.toISOString())

    return c.json({
      accessKeyId: temp.accessKeyId,
      secretAccessKey: temp.secretAccessKey,
      sessionToken: temp.sessionToken,
      expiresAt: expiresAt.toISOString(),
    })
  })
}
