import { Hono } from 'hono'

import { agentSubjectId } from '@/lib/agents/identity'
import {
  getAccessTokenWithExpiry as getAsanaAccessTokenWithExpiry,
  ASANA_API_BASE_URL,
} from '@/lib/byos/asana'
import { getAccessTokenWithExpiry as getJiraAccessTokenWithExpiry } from '@/lib/byos/jira'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import {
  requireLinearWorkspace,
  requireLinearMemberAccess,
  requireJiraSite,
  requireJiraMemberAccess,
  requireAsanaAccount,
  requireAsanaMemberAccess,
} from '@/middleware/auth'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'
import { handOutLinearToken } from '@/routes/linear-workspaces/graphql'

import type { AgentAsanaVars, AgentJiraVars, AgentLinearVars } from '@/routes/agent-sessions/shared'
import type { MiddlewareHandler } from 'hono'

export const linearScoped = new Hono<{ Variables: AgentLinearVars }>()

linearScoped.use('*', requireLinearWorkspace())
linearScoped.use('*', requireLinearMemberAccess())
linearScoped.use('*', requireSelectedLinearAgentCredential())

linearScoped.get('/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('linearBinding')
  const { token, expiresAt } = await handOutLinearToken(teamId, binding)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: c.get('linearWorkspaceId'),
    workspaceId: binding.workspaceId,
    workspaceName: binding.workspaceName,
    organizationUrlKey: binding.organizationUrlKey,
    scope: binding.scope,
    accessToken: token,
    expiresAt: expiresAt?.toISOString() ?? null,
    authType: 'oauth_bearer',
  })
})

export const jiraScoped = new Hono<{ Variables: AgentJiraVars }>()

jiraScoped.use('*', requireJiraSite())
jiraScoped.use('*', requireJiraMemberAccess())
jiraScoped.use('*', requireSelectedJiraAgentCredential())

jiraScoped.get('/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('jiraBinding')
  const { token, expiresAt } = await getJiraAccessTokenWithExpiry(teamId, binding)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: c.get('jiraSiteId'),
    cloudId: binding.cloudId,
    siteName: binding.siteName,
    siteUrl: binding.siteUrl,
    scope: binding.scope,
    accessToken: token,
    expiresAt: expiresAt?.toISOString() ?? null,
    authType: 'oauth_bearer',
  })
})

export const asanaScoped = new Hono<{ Variables: AgentAsanaVars }>()

asanaScoped.use('*', requireAsanaAccount())
asanaScoped.use('*', requireAsanaMemberAccess())
asanaScoped.use('*', requireSelectedAsanaAgentCredential())

asanaScoped.get('/credentials', async (c) => {
  const agent = c.get('agent')
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('asanaBinding')
  const { token, expiresAt } = await getAsanaAccessTokenWithExpiry(teamId, binding)

  c.header('X-Atlas-Agent', agentSubjectId(agent))
  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: c.get('asanaAccountId'),
    accountGid: binding.accountGid,
    accountName: binding.accountName,
    accountEmail: binding.accountEmail,
    apiBaseUrl: ASANA_API_BASE_URL,
    scope: binding.scope,
    accessToken: token,
    expiresAt: expiresAt?.toISOString() ?? null,
    authType: 'oauth_bearer',
  })
})

function requireSelectedLinearAgentCredential(): MiddlewareHandler<{ Variables: AgentLinearVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedWorkspaceIds = credentialAccess.linearWorkspaceIds

    if (selectedWorkspaceIds.length === 0) {
      throw new AppError(
        403,
        'linear_workspace_agent_access_denied',
        'This agent session has no selected Linear workspaces',
      )
    }

    const bindingId = c.get('linearWorkspaceId')

    if (!selectedWorkspaceIds.includes(bindingId)) {
      throw new AppError(
        403,
        'linear_workspace_agent_access_denied',
        'This Linear workspace is not enabled for this agent session',
      )
    }
    await next()
  }
}

function requireSelectedJiraAgentCredential(): MiddlewareHandler<{ Variables: AgentJiraVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedSiteIds = credentialAccess.jiraSiteIds

    if (selectedSiteIds.length === 0) {
      throw new AppError(
        403,
        'jira_site_agent_access_denied',
        'This agent session has no selected Jira sites',
      )
    }

    const bindingId = c.get('jiraSiteId')

    if (!selectedSiteIds.includes(bindingId)) {
      throw new AppError(
        403,
        'jira_site_agent_access_denied',
        'This Jira site is not enabled for this agent session',
      )
    }
    await next()
  }
}

function requireSelectedAsanaAgentCredential(): MiddlewareHandler<{ Variables: AgentAsanaVars }> {
  return async (c, next) => {
    const agent = c.get('agent')
    const teamId = c.get('teamId')
    const credentialAccess = await getAgentCredentialAccess(agent, teamId)
    const selectedAccountIds = credentialAccess.asanaAccountIds

    if (selectedAccountIds.length === 0) {
      throw new AppError(
        403,
        'asana_account_agent_access_denied',
        'This agent session has no selected Asana accounts',
      )
    }

    const bindingId = c.get('asanaAccountId')

    if (!selectedAccountIds.includes(bindingId)) {
      throw new AppError(
        403,
        'asana_account_agent_access_denied',
        'This Asana account is not enabled for this agent session',
      )
    }
    await next()
  }
}
