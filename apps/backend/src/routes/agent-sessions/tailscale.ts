import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { canUseAllowList } from '@/lib/byos/access'
import {
  requireTailnetSandboxTag,
  tailnetSandboxHostname,
  TAILNET_AUTH_KEY_TTL_SECONDS,
} from '@/lib/byos/tailnet-access'
import {
  createTailscaleAuthKey,
  mintTailscaleAccessToken,
  TailscaleApiError,
} from '@/lib/byos/tailscale'
import { tailscaleAuthHandle } from '@/lib/byos/tailscale-binding'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { logEvent } from '@/lib/observability'
import { requireTailscaleClient } from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { AgentTailscaleVars } from '@/routes/agent-sessions/shared'
import type { MiddlewareHandler } from 'hono'

export const tailscaleScoped = new Hono<{ Variables: AgentTailscaleVars }>()

tailscaleScoped.use('*', requireTailscaleClient())
tailscaleScoped.use('*', requireSelectedTailscaleAgentCredential())

tailscaleScoped.get('/credentials', async (c) => {
  const agent = c.get('agent')
  const token = await mintTailscaleAccessToken(
    tailscaleAuthHandle(c.get('tailscaleBindingAuth'), parseObjectId(c.get('teamId'), 'teamId')),
  )

  c.header('Cache-Control', 'no-store')
  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('X-Credentials-Expires-At', token.expiresAt)

  return c.json({
    clientId: c.get('tailscaleClientId'),
    label: c.get('tailscaleClientLabel'),
    oauthClientId: c.get('tailscaleClientOAuthId'),
    accessToken: token.accessToken,
    tokenType: token.tokenType,
    expiresAt: token.expiresAt,
    scope: token.scope,
    tailnet: '-',
    authType: 'oauth_access_token',
  })
})

// The data plane. Unlike /credentials above — which hands out an API token for
// reading the tailnet — this puts the sandbox *inside* the tailnet, so it is
// gated twice: the binding must be opted in by an admin, and the client must
// still be selected in this session's credential selector.
tailscaleScoped.post('/tailnet-sessions', async (c) => {
  const agent = c.get('agent')
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const tag = requireTailnetSandboxTag(c.get('tailscaleSandboxAccess'))
  const hostname = tailnetSandboxHostname(teamId, agent.sessionId)
  const authKey = await createTailscaleAuthKey(
    tailscaleAuthHandle(c.get('tailscaleBindingAuth'), teamId),
    {
      tag,
      description: `Nuphos agent sandbox ${hostname}`,
      expirySeconds: TAILNET_AUTH_KEY_TTL_SECONDS,
    },
  ).catch((err: unknown) => {
    if (err instanceof TailscaleApiError && (err.status === 401 || err.status === 403)) {
      throw new AppError(
        403,
        'tailscale_auth_key_denied',
        `Tailscale refused to mint an auth key for ${tag}. The OAuth client needs the auth_keys scope and must own that tag.`,
      )
    }
    throw new AppError(502, 'tailscale_api_error', (err as Error).message)
  })

  // The hostname is what lets the customer line a row in their own tailnet
  // audit log up against a Nuphos conversation, so it has to be greppable on
  // our side too.
  logEvent('info', 'agent.tailnet.joined', {
    team_id: teamId.toHexString(),
    session_id: agent.sessionId,
    binding_id: c.get('tailscaleClientId'),
    tailnet_tag: tag,
    tailnet_hostname: hostname,
  })

  c.header('Cache-Control', 'no-store')
  c.header('X-Atlas-Agent', agentSubjectId(agent))
  c.header('X-Credentials-Expires-At', authKey.expiresAt)

  return c.json({
    clientId: c.get('tailscaleClientId'),
    label: c.get('tailscaleClientLabel'),
    authKey: authKey.key,
    tag,
    hostname,
    expiresAt: authKey.expiresAt,
  })
})

function requireSelectedTailscaleAgentCredential(): MiddlewareHandler<{
  Variables: AgentTailscaleVars
}> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedClientIds = credentialAccess.tailscaleClientIds

    if (selectedClientIds.length === 0) {
      throw new AppError(
        403,
        'tailscale_client_agent_access_denied',
        'This agent session has no selected Tailscale OAuth clients',
      )
    }

    const clientId = c.get('tailscaleClientId')

    if (!selectedClientIds.includes(clientId)) {
      throw new AppError(
        403,
        'tailscale_client_agent_access_denied',
        'This Tailscale OAuth client is not enabled for this agent session',
      )
    }
    if (!canUseAllowList(c.get('tailscaleAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'tailscale_client_agent_access_denied',
        'This Tailscale OAuth client is not enabled for this agent session',
      )
    }
    await next()
  }
}
