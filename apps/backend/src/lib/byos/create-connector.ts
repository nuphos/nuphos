import { Hono } from 'hono'

import { errorHandler, AppError } from '@/lib/errors'
import { requireTeamMember } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'

export type CloudConnectorProvider =
  'aws' | 'gcp' | 'azure' | 'tencent' | 'aliyun' | 'volcengine' | 'huawei'

// Explicit providers and a fixed POST / mount: the MCP tool cannot dispatch an
// arbitrary API path, impersonate another user, or choose a different team.
async function bindingRoutes(provider: CloudConnectorProvider) {
  switch (provider) {
    case 'aws':
      return (await import('@/routes/aws-accounts')).awsAccountsRoutes
    case 'gcp':
      return (await import('@/routes/gcp-projects')).gcpProjectsRoutes
    case 'azure':
      return (await import('@/routes/azure-accounts')).azureAccountsRoutes
    case 'tencent':
      return (await import('@/routes/tencent-accounts')).tencentAccountsRoutes
    case 'aliyun':
      return (await import('@/routes/aliyun-accounts')).aliyunAccountsRoutes
    case 'volcengine':
      return (await import('@/routes/volcengine-accounts')).volcengineAccountsRoutes
    case 'huawei':
      return (await import('@/routes/huawei-accounts')).huaweiAccountsRoutes
  }
}

/** Same validation, live membership and cloud preflight as Add connector. */
export async function createCloudConnector(
  actor: { userId: string; teamId: string },
  provider: CloudConnectorProvider,
  configuration: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('userId', actor.userId)
    await next()
  })
  app.use('/teams/:teamId/*', requireTeamMember())
  app.route('/teams/:teamId/connectors', await bindingRoutes(provider))
  const response = await app.request(`/teams/${encodeURIComponent(actor.teamId)}/connectors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(configuration),
  })
  const body = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    const error = body.error as { message?: string; code?: string } | undefined

    throw new AppError(
      response.status as AppError['status'],
      error?.code ?? 'connector_creation_failed',
      error?.message ?? 'Could not create the connector',
    )
  }

  return body
}
