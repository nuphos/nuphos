import crypto from 'node:crypto'

import { Hono } from 'hono'

import {
  buildAuthorizeUrl,
  getAccessTokenWithExpiry,
  getDefaultClientCredentials,
  getSetupRedirect,
  isSentryConfigured,
  invalidateSentryAccessToken,
  SENTRY_API_BASE_URL,
} from '@/lib/byos/sentry'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { requireTeamRole, requireSentryAccount, requireSentryMemberAccess } from '@/middleware/auth'
import { sentryPendingOAuth, teamByosBindings } from '@/models'

import type { TeamAuthVariables, SentryAccountVariables } from '@/middleware/auth'
import type { SentryAccountBinding } from '@/models'

export const sentryAccountsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Read-only scopes: the agent's job is to investigate errors, not mutate them.
// `org:read` is what lets it enumerate organizations at query time (OAuth is
// account-wide, so the binding isn't pinned to one org). Widening this to any
// :write scope means re-authorising every existing binding.
const DEFAULT_SCOPE = 'org:read project:read team:read member:read event:read'
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

export function publicView(b: SentryAccountBinding) {
  return {
    id: b.id.toHexString(),
    label: b.label,
    userId: b.userId,
    userName: b.userName,
    userEmail: b.userEmail,
    scope: b.scope,
    createdAt: b.createdAt,
  }
}

sentryAccountsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { sentryAccounts: 1 } },
  )

  return c.json({
    accounts: (doc?.sentryAccounts ?? []).map(publicView),
  })
})

sentryAccountsRoutes.post('/start-oauth', requireTeamRole('ADMINISTRATOR'), async (c) => {
  if (!isSentryConfigured()) {
    throw new AppError(
      503,
      'sentry_oauth_not_configured',
      'Sentry OAuth is not configured on the server (set SENTRY_OAUTH_CLIENT_ID/SECRET, SENTRY_OAUTH_SETUP_REDIRECT, SENTRY_TOKEN_ENCRYPTION_KEY)',
    )
  }
  const credentials = getDefaultClientCredentials()
  const setupRedirect = getSetupRedirect()

  if (!credentials || !setupRedirect) {
    throw new AppError(503, 'sentry_oauth_not_configured', 'Sentry OAuth is not fully configured')
  }

  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const requesterUserId = c.get('userId')

  const state = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

  await sentryPendingOAuth().insertOne({
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

sentryAccountsRoutes.delete('/start-oauth/:state', requireTeamRole('ADMINISTRATOR'), async (c) => {
  // Allow the desktop to cancel a pending grant if the user closes the dialog
  // before authorising in the browser. Idempotent.
  const state = c.req.param('state')

  if (!state || !/^[a-f0-9]{1,128}$/i.test(state)) {
    throw new AppError(400, 'invalid_state', 'Invalid state token')
  }
  const teamId = parseObjectId(c.get('teamId'), 'teamId')

  await sentryPendingOAuth().deleteOne({ _id: state, teamId })

  return c.body(null, 204)
})

const bindingScoped = new Hono<{ Variables: SentryAccountVariables }>()

bindingScoped.use('*', requireSentryAccount())

bindingScoped.get('/', (c) => {
  return c.json(publicView(c.get('sentryBinding')))
})

bindingScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('sentryBinding')

  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { sentryAccounts: { id: binding.id } },
      $set: { updatedAt: new Date() },
    },
  )
  // Unlike Asana/GitLab there is no revokeGrant step: Sentry exposes no OAuth
  // revocation endpoint, so a token already handed to a sandbox stays valid at
  // Sentry until it expires (~30d). Dropping the cache is all we can do server
  // side; the user must revoke at Sentry's Authorized Applications page to kill
  // the grant immediately.
  invalidateSentryAccessToken(teamId, binding.id)

  return c.body(null, 204)
})

// Agent credential handout, mirroring asana-accounts /credentials: the sandbox
// exchanges its NUPHOS_TOKEN for a fresh (auto-refreshed) Sentry access token
// and calls sentry.io/api/0 directly. Gated by the per-binding member
// allow-list.
bindingScoped.get('/credentials', requireSentryMemberAccess(), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = c.get('sentryBinding')
  const { token, expiresAt } = await getAccessTokenWithExpiry(teamId, binding)

  if (expiresAt) c.header('X-Credentials-Expires-At', expiresAt.toISOString())
  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: binding.id.toHexString(),
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

sentryAccountsRoutes.route('/:bindingId', bindingScoped)
