import crypto from 'node:crypto'

import { Hono } from 'hono'

import {
  buildAuthorizeUrl,
  getDefaultClientCredentials,
  getSetupRedirect,
  invalidateAccessToken,
  isLinearConfigured,
} from '@/lib/byos/linear'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import {
  requireTeamRole,
  requireLinearWorkspace,
  requireLinearMemberAccess,
} from '@/middleware/auth'
import { linearPendingOAuth, teamByosBindings } from '@/models'
import { registerLinearBrowseRoutes } from '@/routes/linear-workspaces/browse'
import { handOutLinearToken } from '@/routes/linear-workspaces/graphql'
import { registerLinearIssueDetailRoute } from '@/routes/linear-workspaces/issue-detail'

import type { TeamAuthVariables, LinearWorkspaceVariables } from '@/middleware/auth'
import type { LinearWorkspaceBinding } from '@/models'

export const linearWorkspacesRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// read,write covers reading issues/teams/workflow states and creating/updating
// issues + comments — everything the closed-loop skill needs.
const DEFAULT_SCOPE = 'read,write'
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

export function publicView(b: LinearWorkspaceBinding) {
  return {
    id: b.id.toHexString(),
    label: b.label,
    workspaceId: b.workspaceId,
    workspaceName: b.workspaceName,
    organizationUrlKey: b.organizationUrlKey,
    accountName: b.accountName,
    scope: b.scope,
    createdAt: b.createdAt,
  }
}

linearWorkspacesRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { linearWorkspaces: 1 } },
  )

  return c.json({
    workspaces: (doc?.linearWorkspaces ?? []).map(publicView),
  })
})

linearWorkspacesRoutes.post('/start-oauth', requireTeamRole('ADMINISTRATOR'), async (c) => {
  if (!isLinearConfigured()) {
    throw new AppError(
      503,
      'linear_oauth_not_configured',
      'Linear OAuth is not configured on the server (set LINEAR_OAUTH_CLIENT_ID/SECRET, LINEAR_OAUTH_SETUP_REDIRECT, LINEAR_TOKEN_ENCRYPTION_KEY)',
    )
  }
  const credentials = getDefaultClientCredentials()
  const setupRedirect = getSetupRedirect()

  if (!credentials || !setupRedirect) {
    throw new AppError(503, 'linear_oauth_not_configured', 'Linear OAuth is not fully configured')
  }

  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const requesterUserId = c.get('userId')

  const state = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

  await linearPendingOAuth().insertOne({
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

linearWorkspacesRoutes.delete(
  '/start-oauth/:state',
  requireTeamRole('ADMINISTRATOR'),
  async (c) => {
    // Allow the desktop to cancel a pending grant if the user closes the dialog
    // before authorising in the browser. Idempotent.
    const state = c.req.param('state')

    if (!state || !/^[a-f0-9]{1,128}$/i.test(state)) {
      throw new AppError(400, 'invalid_state', 'Invalid state token')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    await linearPendingOAuth().deleteOne({ _id: state, teamId })

    return c.body(null, 204)
  },
)

const bindingScoped = new Hono<{ Variables: LinearWorkspaceVariables }>()

bindingScoped.use('*', requireLinearWorkspace())

bindingScoped.get('/', (c) => {
  return c.json(publicView(c.get('linearBinding')))
})

bindingScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('linearBinding')

  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { linearWorkspaces: { id: binding.id } },
      $set: { updatedAt: new Date() },
    },
  )
  invalidateAccessToken(teamId, binding.id)

  return c.body(null, 204)
})

// Agent credential handout, mirroring github-installations /token and
// betterstack /credentials: the sandbox exchanges its NUPHOS_TOKEN for the
// binding's Linear access token and talks to api.linear.app directly. Gated by
// the per-binding member allow-list.
bindingScoped.get('/credentials', requireLinearMemberAccess(), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('linearBinding')
  const { token, expiresAt } = await handOutLinearToken(teamId, binding)

  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: binding.id.toHexString(),
    workspaceId: binding.workspaceId,
    workspaceName: binding.workspaceName,
    organizationUrlKey: binding.organizationUrlKey,
    scope: binding.scope,
    accessToken: token,
    expiresAt: expiresAt?.toISOString() ?? null,
    authType: 'oauth_bearer',
  })
})

registerLinearIssueDetailRoute(bindingScoped)
registerLinearBrowseRoutes(bindingScoped)

linearWorkspacesRoutes.route('/:bindingId', bindingScoped)
