import crypto from 'node:crypto'

import { Hono } from 'hono'

import {
  buildAuthorizeUrl,
  getAccessTokenWithExpiry,
  getDefaultClientCredentials,
  getSetupRedirect,
  isAsanaConfigured,
  invalidateAsanaAccessToken,
  revokeGrant,
  ASANA_API_BASE_URL,
} from '@/lib/byos/asana'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { requireTeamRole, requireAsanaAccount, requireAsanaMemberAccess } from '@/middleware/auth'
import { asanaPendingOAuth, teamByosBindings } from '@/models'

import type { TeamAuthVariables, AsanaAccountVariables } from '@/middleware/auth'
import type { AsanaAccountBinding } from '@/models'

export const asanaAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// `default` grants the app the full set of permissions the authorising user
// holds — read/write access to their workspaces, projects, tasks and users.
// Asana always returns a long-lived (non-rotating) refresh token, so no
// offline-access-style scope is required.
const DEFAULT_SCOPE = 'default'
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

export function publicView(b: AsanaAccountBinding) {
  return {
    id: b.id.toHexString(),
    label: b.label,
    accountGid: b.accountGid,
    accountName: b.accountName,
    accountEmail: b.accountEmail,
    scope: b.scope,
    createdAt: b.createdAt,
  }
}

asanaAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { asanaAccounts: 1 } },
  )

  return c.json({
    accounts: (doc?.asanaAccounts ?? []).map(publicView),
  })
})

asanaAccountsRoutes.post('/start-oauth', requireTeamRole('ADMINISTRATOR'), async (c) => {
  if (!isAsanaConfigured()) {
    throw new AppError(
      503,
      'asana_oauth_not_configured',
      'Asana OAuth is not configured on the server (set ASANA_OAUTH_CLIENT_ID/SECRET, ASANA_OAUTH_SETUP_REDIRECT, ASANA_TOKEN_ENCRYPTION_KEY)',
    )
  }
  const credentials = getDefaultClientCredentials()
  const setupRedirect = getSetupRedirect()

  if (!credentials || !setupRedirect) {
    throw new AppError(503, 'asana_oauth_not_configured', 'Asana OAuth is not fully configured')
  }

  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const requesterUserId = c.get('userId')

  const state = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

  await asanaPendingOAuth().insertOne({
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

asanaAccountsRoutes.delete('/start-oauth/:state', requireTeamRole('ADMINISTRATOR'), async (c) => {
  // Allow the desktop to cancel a pending grant if the user closes the dialog
  // before authorising in the browser. Idempotent.
  const state = c.req.param('state')

  if (!state || !/^[a-f0-9]{1,128}$/i.test(state)) {
    throw new AppError(400, 'invalid_state', 'Invalid state token')
  }
  const teamId = parseObjectId(c.get('teamId'), 'teamId')

  await asanaPendingOAuth().deleteOne({ _id: state, teamId })

  return c.body(null, 204)
})

const bindingScoped = new Hono<{ Variables: AsanaAccountVariables }>()

bindingScoped.use('*', requireAsanaAccount())

bindingScoped.get('/', (c) => {
  return c.json(publicView(c.get('asanaBinding')))
})

bindingScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('asanaBinding')

  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { asanaAccounts: { id: binding.id } },
      $set: { updatedAt: new Date() },
    },
  )
  invalidateAsanaAccessToken(teamId, binding.id)
  // Best-effort: revoke the grant at Asana so the long-lived refresh token (and
  // any access token already handed to a sandbox) stops working. Runs AFTER the
  // DB write so a revoke failure/crash never leaves a persisted binding whose
  // tokens are already dead at Asana. Don't block the unbind on it — the local
  // binding is already gone even if Asana is unreachable.
  await revokeGrant(binding)

  return c.body(null, 204)
})

// Agent credential handout, mirroring jira-sites /credentials: the sandbox
// exchanges its NUPHOS_TOKEN for a fresh (auto-refreshed) Asana access token and
// calls app.asana.com/api/1.0 directly. Gated by the per-binding member
// allow-list.
bindingScoped.get('/credentials', requireAsanaMemberAccess(), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('asanaBinding')
  const { token, expiresAt } = await getAccessTokenWithExpiry(teamId, binding)

  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: binding.id.toHexString(),
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

asanaAccountsRoutes.route('/:bindingId', bindingScoped)
