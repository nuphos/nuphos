import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import { canUseAllowList } from '@/lib/byos/access'
import { getCloudflareOAuthAccessToken } from '@/lib/byos/cloudflare-oauth'
import {
  decryptCloudflareApiKey,
  decryptLinodeToken,
  decryptHetznerToken,
} from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import {
  requireCloudflareAccount,
  requireLinodeAccount,
  requireHetznerAccount,
} from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { CloudflareAccountVariables } from '@/middleware/auth'
import type { AgentHetznerVars, AgentLinodeVars, AgentVars } from '@/routes/agent-sessions/shared'
import type { MiddlewareHandler } from 'hono'

export const cloudflareScoped = new Hono<{ Variables: AgentVars & CloudflareAccountVariables }>()

cloudflareScoped.use('*', requireCloudflareAccount())
cloudflareScoped.use('*', requireSelectedCloudflareAgentCredential())

cloudflareScoped.get('/credentials', async (c) => {
  // The agent calls the Cloudflare API directly, so it needs a usable bearer:
  // a short-lived OAuth access token for OAuth bindings, or the decrypted
  // scoped API token for legacy bindings.
  const binding = c.get('cloudflareBinding')

  if (binding.oauth) {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    return c.json({
      accountId: c.get('cloudflareAccountId'),
      accountName: c.get('cloudflareAccountName'),
      apiKey: await getCloudflareOAuthAccessToken(teamId, binding),
      authType: 'oauth',
    })
  }
  const encryptedApiKey = c.get('cloudflareEncryptedApiKey')

  if (!encryptedApiKey) {
    throw new AppError(500, 'cloudflare_no_credentials', 'Cloudflare binding has no credentials')
  }

  return c.json({
    accountId: c.get('cloudflareAccountId'),
    accountName: c.get('cloudflareAccountName'),
    apiKey: decryptCloudflareApiKey(encryptedApiKey),
    authType: 'api_token',
  })
})

export const linodeScoped = new Hono<{ Variables: AgentLinodeVars }>()

linodeScoped.use('*', requireLinodeAccount())
linodeScoped.use('*', requireSelectedLinodeAgentCredential())

linodeScoped.get('/credentials', (c) => {
  const agent = c.get('agent')

  c.header('X-Atlas-Agent', agentSubjectId(agent))

  return c.json({
    accountId: c.get('linodeAccountId'),
    label: c.get('linodeAccountLabel'),
    token: decryptLinodeToken(c.get('linodeEncryptedToken')),
    authType: 'personal_access_token',
  })
})

export const hetznerScoped = new Hono<{ Variables: AgentHetznerVars }>()

hetznerScoped.use('*', requireHetznerAccount())
hetznerScoped.use('*', requireSelectedHetznerAgentCredential())

hetznerScoped.get('/credentials', (c) => {
  const agent = c.get('agent')

  c.header('X-Atlas-Agent', agentSubjectId(agent))

  return c.json({
    accountId: c.get('hetznerAccountId'),
    label: c.get('hetznerAccountLabel'),
    token: decryptHetznerToken(c.get('hetznerEncryptedToken')),
    authType: 'api_token',
  })
})

function requireSelectedCloudflareAgentCredential(): MiddlewareHandler<{
  Variables: AgentVars & CloudflareAccountVariables
}> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedAccountIds = credentialAccess.cloudflareAccountIds

    // Conversations created before Cloudflare joined the selected-credential
    // tier store no id list at all; those keep their team-wide reach. Once a
    // client writes the list, an empty one means "none selected".
    if (selectedAccountIds && !selectedAccountIds.includes(c.get('cloudflareAccountId'))) {
      throw new AppError(
        403,
        'cloudflare_account_agent_access_denied',
        'This Cloudflare account is not enabled for this agent session',
      )
    }
    if (!canUseAllowList(c.get('cloudflareBinding').access?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'cloudflare_account_agent_access_denied',
        'This Cloudflare account is not enabled for this agent session',
      )
    }
    await next()
  }
}

function requireSelectedLinodeAgentCredential(): MiddlewareHandler<{ Variables: AgentLinodeVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedAccountIds = credentialAccess.linodeAccountIds

    if (selectedAccountIds.length === 0) {
      throw new AppError(
        403,
        'linode_account_agent_access_denied',
        'This agent session has no selected Linode accounts',
      )
    }

    const accountId = c.get('linodeAccountId')

    if (!selectedAccountIds.includes(accountId)) {
      throw new AppError(
        403,
        'linode_account_agent_access_denied',
        'This Linode account is not enabled for this agent session',
      )
    }
    if (!canUseAllowList(c.get('linodeAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'linode_account_agent_access_denied',
        'This Linode account is not enabled for this agent session',
      )
    }
    await next()
  }
}

function requireSelectedHetznerAgentCredential(): MiddlewareHandler<{
  Variables: AgentHetznerVars
}> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedAccountIds = credentialAccess.hetznerAccountIds

    if (selectedAccountIds.length === 0) {
      throw new AppError(
        403,
        'hetzner_account_agent_access_denied',
        'This agent session has no selected Hetzner accounts',
      )
    }

    const accountId = c.get('hetznerAccountId')

    if (!selectedAccountIds.includes(accountId)) {
      throw new AppError(
        403,
        'hetzner_account_agent_access_denied',
        'This Hetzner account is not enabled for this agent session',
      )
    }
    if (!canUseAllowList(c.get('hetznerAccess')?.memberAllowList, c.get('userId'))) {
      throw new AppError(
        403,
        'hetzner_account_agent_access_denied',
        'This Hetzner account is not enabled for this agent session',
      )
    }
    await next()
  }
}
