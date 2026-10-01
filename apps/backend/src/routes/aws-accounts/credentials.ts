import { config } from '@/config'
import { assumeRoleAsConnector, sanitizeSessionName } from '@/lib/byos/aws'
import { AppError } from '@/lib/errors'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

/** Team-scoped credential export declared by the public API contract. Cost
 * panel sandboxes are durable dashboard jobs rather than agent conversations,
 * so they authenticate as the script author and use this route instead of the
 * `/agent-sessions/:sessionId/...` variant. */
export function registerAwsCredentialRoutes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  accountScoped.get('/credentials', async (c) => {
    const binding = c.get('awsBinding')

    // Match the GCP credential route: IAM-write break-glass credentials must
    // never leave the backend, even when explicitly selected by an admin.
    if (binding.purpose === 'permission-admin') {
      throw new AppError(
        403,
        'permission_admin_no_credential_export',
        'Credentials for a permission-admin role cannot be exported; use the scoped IAM grant/revoke endpoints instead',
      )
    }
    const temp = await assumeRoleAsConnector(c.get('awsRoleArn'), {
      sessionName: sanitizeSessionName(`nuphos-user-${c.get('userId')}`),
    })
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
