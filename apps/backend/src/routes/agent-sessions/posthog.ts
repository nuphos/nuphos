import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { getPosthogAccessToken, PosthogReconnectRequired } from '@/lib/byos/posthog-tokens'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { requirePosthogIntegration, requirePosthogMemberAccess } from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'
import { posthogReconnectError } from '@/routes/posthog-integrations/shared'

import type { AgentPosthogVars } from '@/routes/agent-sessions/shared'
import type { MiddlewareHandler } from 'hono'

export const posthogScoped = new Hono<{ Variables: AgentPosthogVars }>()

posthogScoped.use('*', requirePosthogIntegration())
posthogScoped.use('*', requirePosthogMemberAccess())
posthogScoped.use('*', requireSelectedPosthogAgentCredential())

posthogScoped.get('/credentials', async (c) => {
  const binding = c.get('posthogBinding')
  const { token, expiresAt } = await getPosthogAccessToken(
    parseObjectId(c.get('teamId'), 'teamId'),
    binding,
  ).catch((error: unknown) => {
    if (error instanceof PosthogReconnectRequired) throw posthogReconnectError()
    throw error
  })

  c.header('X-Atlas-Agent', agentSubjectId(c.get('agent')))
  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: c.get('posthogIntegrationId'),
    label: binding.label,
    region: binding.region,
    apiBaseUrl: binding.apiBaseUrl,
    accessToken: token,
    expiresAt: expiresAt?.toISOString() ?? null,
    scope: binding.scope,
    userEmail: binding.userEmail,
    projects: binding.projects,
    defaultProjectId: binding.projects[0]?.id ?? null,
    authType: 'oauth_bearer',
  })
})

function requireSelectedPosthogAgentCredential(): MiddlewareHandler<{
  Variables: AgentPosthogVars
}> {
  return async (c, next) => {
    const credentialAccess = await getAgentCredentialAccess(c.get('agent'), c.get('teamId'))

    if (!credentialAccess.posthogIntegrationIds.includes(c.get('posthogIntegrationId'))) {
      throw new AppError(
        403,
        'posthog_integration_agent_access_denied',
        'This PostHog integration is not enabled for this agent session',
      )
    }
    await next()
  }
}
