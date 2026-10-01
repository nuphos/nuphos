import crypto from 'node:crypto'

import { Hono } from 'hono'

import {
  buildAuthorizeUrl,
  getAccessTokenWithExpiry,
  getDefaultClientCredentials,
  getSetupRedirect,
  invalidateAccessToken,
  isJiraConfigured,
} from '@/lib/byos/jira'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { requireTeamRole, requireJiraSite, requireJiraMemberAccess } from '@/middleware/auth'
import { jiraPendingOAuth, teamByosBindings } from '@/models'

import type { TeamAuthVariables, JiraSiteVariables } from '@/middleware/auth'
import type { JiraSiteBinding } from '@/models'

export const jiraSitesRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// read:jira-work/write:jira-work cover reading + creating/updating issues and
// comments; read:jira-user resolves assignees; offline_access yields the
// rotating refresh token the backend stores to keep the access token fresh.
const DEFAULT_SCOPE = 'read:jira-work write:jira-work read:jira-user offline_access'
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

export function publicView(b: JiraSiteBinding) {
  return {
    id: b.id.toHexString(),
    label: b.label,
    cloudId: b.cloudId,
    siteName: b.siteName,
    siteUrl: b.siteUrl,
    accountName: b.accountName,
    scope: b.scope,
    createdAt: b.createdAt,
  }
}

jiraSitesRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne({ _id: teamId }, { projection: { jiraSites: 1 } })

  return c.json({
    sites: (doc?.jiraSites ?? []).map(publicView),
  })
})

jiraSitesRoutes.post('/start-oauth', requireTeamRole('ADMINISTRATOR'), async (c) => {
  if (!isJiraConfigured()) {
    throw new AppError(
      503,
      'jira_oauth_not_configured',
      'Jira OAuth is not configured on the server (set JIRA_OAUTH_CLIENT_ID/SECRET, JIRA_OAUTH_SETUP_REDIRECT, JIRA_TOKEN_ENCRYPTION_KEY)',
    )
  }
  const credentials = getDefaultClientCredentials()
  const setupRedirect = getSetupRedirect()

  if (!credentials || !setupRedirect) {
    throw new AppError(503, 'jira_oauth_not_configured', 'Jira OAuth is not fully configured')
  }

  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const requesterUserId = c.get('userId')

  const state = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

  await jiraPendingOAuth().insertOne({
    _id: state,
    teamId,
    requesterUserId,
    expiresAt,
  })

  const authorizeUrl = buildAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri: setupRedirect,
    state,
    scope: DEFAULT_SCOPE,
  })

  return c.json({
    authorizeUrl,
    state,
    expiresAt: expiresAt.toISOString(),
  })
})

jiraSitesRoutes.delete('/start-oauth/:state', requireTeamRole('ADMINISTRATOR'), async (c) => {
  // Allow the desktop to cancel a pending grant if the user closes the dialog
  // before authorising in the browser. Idempotent.
  const state = c.req.param('state')

  if (!state || !/^[a-f0-9]{1,128}$/i.test(state)) {
    throw new AppError(400, 'invalid_state', 'Invalid state token')
  }
  const teamId = parseObjectId(c.get('teamId'), 'teamId')

  await jiraPendingOAuth().deleteOne({ _id: state, teamId })

  return c.body(null, 204)
})

const bindingScoped = new Hono<{ Variables: JiraSiteVariables }>()

bindingScoped.use('*', requireJiraSite())

bindingScoped.get('/', (c) => {
  return c.json(publicView(c.get('jiraBinding')))
})

bindingScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('jiraBinding')

  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { jiraSites: { id: binding.id } },
      $set: { updatedAt: new Date() },
    },
  )
  invalidateAccessToken(teamId, binding.id)

  return c.body(null, 204)
})

// Agent credential handout, mirroring linear-workspaces /credentials: the
// sandbox exchanges its NUPHOS_TOKEN for a fresh (auto-refreshed) Atlassian
// access token + cloudId and calls api.atlassian.com/ex/jira/<cloudId> directly.
// Gated by the per-binding member allow-list.
bindingScoped.get('/credentials', requireJiraMemberAccess(), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('jiraBinding')
  const { token, expiresAt } = await getAccessTokenWithExpiry(teamId, binding)

  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: binding.id.toHexString(),
    cloudId: binding.cloudId,
    siteName: binding.siteName,
    siteUrl: binding.siteUrl,
    scope: binding.scope,
    accessToken: token,
    expiresAt: expiresAt?.toISOString() ?? null,
    authType: 'oauth_bearer',
  })
})

jiraSitesRoutes.route('/:bindingId', bindingScoped)
