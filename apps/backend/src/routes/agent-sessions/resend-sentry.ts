import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { apiKeyFromBinding, RESEND_API_BASE_URL } from '@/lib/byos/resend'
import {
  getAccessTokenWithExpiry as getSentryAccessTokenWithExpiry,
  SENTRY_API_BASE_URL,
} from '@/lib/byos/sentry'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import {
  requireResendIntegration,
  requireResendMemberAccess,
  requireSentryAccount,
  requireSentryMemberAccess,
} from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { AgentResendVars, AgentSentryVars } from '@/routes/agent-sessions/shared'
import type { MiddlewareHandler } from 'hono'

// Resend is the only provider whose raw credential is handed out ONLY here and
// never from the team-scoped route. Sending mail is irreversible, so a binding
// being bound to the team is not enough — it must also be enabled for this
// specific conversation. See requireSelectedResendAgentCredential below and the
// resendIntegrationIds: [] default in agent.ts.
export const resendScoped = new Hono<{ Variables: AgentResendVars }>()

resendScoped.use('*', requireResendIntegration())
resendScoped.use('*', requireResendMemberAccess())
resendScoped.use('*', requireSelectedResendAgentCredential())

resendScoped.get('/credentials', (c) => {
  const agent = c.get('agent')
  const binding = c.get('resendBinding')
  const apiKey = apiKeyFromBinding(binding)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: c.get('resendIntegrationId'),
    label: binding.label,
    permission: binding.permission,
    apiKey,
    apiBaseUrl: RESEND_API_BASE_URL,
    authType: 'resend_bearer',
  })
})

export const sentryScoped = new Hono<{ Variables: AgentSentryVars }>()

sentryScoped.use('*', requireSentryAccount())
sentryScoped.use('*', requireSentryMemberAccess())
sentryScoped.use('*', requireSelectedSentryAgentCredential())

sentryScoped.get('/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('sentryBinding')
  const { token, expiresAt } = await getSentryAccessTokenWithExpiry(teamId, binding)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: c.get('sentryAccountId'),
    userId: binding.userId,
    userName: binding.userName,
    userEmail: binding.userEmail,
    apiBaseUrl: SENTRY_API_BASE_URL,
    scope: binding.scope,
    accessToken: token,
    expiresAt: expiresAt?.toISOString() ?? null,
    authType: 'oauth_bearer',
  })
})

function requireSelectedSentryAgentCredential(): MiddlewareHandler<{ Variables: AgentSentryVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedAccountIds = credentialAccess.sentryAccountIds ?? []

    if (selectedAccountIds.length === 0) {
      throw new AppError(
        403,
        'sentry_account_agent_access_denied',
        'This agent session has no selected Sentry accounts',
      )
    }

    const bindingId = c.get('sentryAccountId')

    if (!selectedAccountIds.includes(bindingId)) {
      throw new AppError(
        403,
        'sentry_account_agent_access_denied',
        'This Sentry account is not enabled for this agent session',
      )
    }
    await next()
  }
}

function requireSelectedResendAgentCredential(): MiddlewareHandler<{ Variables: AgentResendVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedIntegrationIds = credentialAccess.resendIntegrationIds

    if (selectedIntegrationIds.length === 0) {
      throw new AppError(
        403,
        'resend_integration_agent_access_denied',
        'This agent session has no selected Resend integrations',
      )
    }

    const bindingId = c.get('resendIntegrationId')

    if (!selectedIntegrationIds.includes(bindingId)) {
      throw new AppError(
        403,
        'resend_integration_agent_access_denied',
        'This Resend integration is not enabled for this agent session',
      )
    }
    await next()
  }
}
