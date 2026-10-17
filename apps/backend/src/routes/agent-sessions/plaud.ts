import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { getPlaudAccessToken, PLAUD_API_BASE_URL, PLAUD_MCP_URL } from '@/lib/byos/plaud'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'
import { requirePlaudAccount, requirePlaudMemberAccess } from '@/routes/plaud-accounts'

import type { AgentVars } from '@/routes/agent-sessions/shared'
import type { PlaudAccountVariables } from '@/routes/plaud-accounts'

export const plaudScoped = new Hono<{ Variables: AgentVars & PlaudAccountVariables }>()

plaudScoped.use('*', requirePlaudAccount())
plaudScoped.use('*', requirePlaudMemberAccess())
plaudScoped.use('*', async (c, next) => {
  const access = await getAgentCredentialAccess(c.get('agent'), c.get('teamId'))

  if (!access.plaudAccountIds.includes(c.get('plaudAccountId'))) {
    throw new AppError(
      403,
      'plaud_account_agent_access_denied',
      'This Plaud account is not enabled for this agent session',
    )
  }
  await next()
})

plaudScoped.get('/credentials', async (c) => {
  const binding = c.get('plaudBinding')
  const { token, expiresAt } = await getPlaudAccessToken(
    parseObjectId(c.get('teamId'), 'teamId'),
    binding,
  )

  c.header('X-Atlas-Agent', agentSubjectId(c.get('agent')))
  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: c.get('plaudAccountId'),
    label: binding.label,
    userName: binding.userName,
    userEmail: binding.userEmail,
    apiBaseUrl: PLAUD_API_BASE_URL,
    mcpUrl: PLAUD_MCP_URL,
    accessToken: token,
    expiresAt: expiresAt?.toISOString() ?? null,
    authType: 'oauth_bearer',
  })
})
