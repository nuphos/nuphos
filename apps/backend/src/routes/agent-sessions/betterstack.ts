import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { decryptBetterStackToken } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { requireBetterStackIntegration, requireBetterStackMemberAccess } from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { AgentBetterStackVars } from '@/routes/agent-sessions/shared'
import type { MiddlewareHandler } from 'hono'

export const betterStackScoped = new Hono<{ Variables: AgentBetterStackVars }>()

betterStackScoped.use('*', requireBetterStackIntegration())
betterStackScoped.use('*', requireBetterStackMemberAccess())
betterStackScoped.use('*', requireSelectedBetterStackAgentCredential())

betterStackScoped.get('/credentials', (c) => {
  const agent = c.get('agent')
  const uptimeEnvelope = c.get('betterStackEncryptedUptimeApiToken')
  const telemetryEnvelope = c.get('betterStackEncryptedTelemetryApiToken')

  c.header('X-Atlas-Agent', agentSubjectId(agent))

  return c.json({
    integrationId: c.get('betterStackIntegrationId'),
    label: c.get('betterStackLabel'),
    uptimeApiToken: uptimeEnvelope ? decryptBetterStackToken(uptimeEnvelope) : null,
    telemetryApiToken: telemetryEnvelope ? decryptBetterStackToken(telemetryEnvelope) : null,
    authType: 'api_token',
  })
})

function requireSelectedBetterStackAgentCredential(): MiddlewareHandler<{
  Variables: AgentBetterStackVars
}> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedIntegrationIds = credentialAccess.betterStackIntegrationIds

    if (selectedIntegrationIds.length === 0) {
      throw new AppError(
        403,
        'betterstack_integration_agent_access_denied',
        'This agent session has no selected Better Stack integrations',
      )
    }

    const integrationId = c.get('betterStackIntegrationId')

    if (!selectedIntegrationIds.includes(integrationId)) {
      throw new AppError(
        403,
        'betterstack_integration_agent_access_denied',
        'This Better Stack integration is not enabled for this agent session',
      )
    }
    await next()
  }
}
