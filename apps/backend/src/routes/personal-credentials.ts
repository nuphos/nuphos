import { Hono } from 'hono'

import { verifyPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import {
  claimPersonalCredential,
  deletePersonalCredential,
  listPersonalCredentials,
  PERSONAL_CREDENTIAL_PROVIDERS,
  personalGoogleToken,
  stagePersonalCredentialOAuth,
  startPersonalCredentialOAuth,
} from '@/lib/personal-credentials'
import { isGoogleProvider, teamGoogleClient } from '@/lib/personal-credentials/google'
import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'
import type { PersonalCredentialProvider } from '@/models'

// A member's own GitHub / Linear / Google grants. Only a signed-in user session reaches
// these: conversation tokens are not accepted by requireAuth, so an agent can
// never start, list or remove a Personal Credential.
export const personalCredentialRoutes = new Hono<{ Variables: AuthVariables }>()

// The approver's app claims the staged grant with its signed-in session.
const DESKTOP_RETURN = 'nuphos://personal-credential'

function providerParam(value: string | undefined): PersonalCredentialProvider {
  if (!PERSONAL_CREDENTIAL_PROVIDERS.includes(value as PersonalCredentialProvider)) {
    throw new AppError(404, 'not_found', 'Unknown Personal Credential provider')
  }

  return value as PersonalCredentialProvider
}

personalCredentialRoutes.get('/', requireAuth, async (c) =>
  c.json({ credentials: await listPersonalCredentials(c.get('userId')) }),
)

// Gmail / Google Drive name the team whose OAuth client to connect through.
personalCredentialRoutes.post('/:provider/start', requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { teamId?: unknown } | null
  const teamId = typeof body?.teamId === 'string' ? body.teamId : undefined

  return c.json(
    await startPersonalCredentialOAuth(
      c.get('userId'),
      providerParam(c.req.param('provider')),
      teamId,
    ),
  )
})

// The member's own app finishes a grant the callback staged, proving with the
// callback's one-time code that the approval reached it.
personalCredentialRoutes.post('/:provider/complete', requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { state?: unknown; code?: unknown } | null

  if (typeof body?.state !== 'string' || typeof body.code !== 'string') {
    throw new AppError(400, 'invalid_request', 'Body must include the callback state and code')
  }

  return c.json(
    await claimPersonalCredential(
      c.get('userId'),
      providerParam(c.req.param('provider')),
      body.state,
      body.code,
    ),
  )
})

personalCredentialRoutes.delete('/:provider', requireAuth, async (c) => {
  await deletePersonalCredential(
    c.get('userId'),
    providerParam(c.req.param('provider')),
    c.req.query('teamId'),
  )

  return c.body(null, 204)
})

// Public: the provider redirects the browser here. The state ties the code to
// the member who started the flow; it is single-use and expires in 10 minutes.
personalCredentialRoutes.get('/:provider/callback', async (c) => {
  const provider = providerParam(c.req.param('provider'))
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  const back = (params: Record<string, string>) =>
    desktopCallbackResponse(c, DESKTOP_RETURN, params)

  if (!state || !code) return back({ provider, error: c.req.query('error') ?? 'missing_code' })
  try {
    return back({ provider, ...(await stagePersonalCredentialOAuth(provider, state, code)) })
  } catch (error) {
    logError('personal_credential.callback_failed', error, { provider })

    return back({ provider, error: error instanceof AppError ? error.code : 'exchange_failed' })
  }
})

// Mounted under /teams/:teamId for conversation tokens: the agent's Gmail /
// Google Drive handout. It is always the session owner's own grant, issued by
// this team's OAuth client, and a teammate's message in that session gets none:
// a shared session may run on someone else's runtime, so mail and files never
// leave their owner's sessions. There is no team token to fall back to.
export const personalCredentialTokenRoutes = new Hono()

personalCredentialTokenRoutes.get('/:provider/token', async (c) => {
  const provider = c.req.param('provider')

  if (!isGoogleProvider(provider)) {
    throw new AppError(404, 'not_found', 'Unknown Personal Credential provider')
  }
  const authorization = c.req.header('Authorization') ?? ''
  const claims = authorization.startsWith('Bearer ')
    ? verifyPreviewMcpToken(authorization.slice('Bearer '.length))
    : null

  if (!claims) {
    throw new AppError(403, 'forbidden', 'Only an agent conversation can use this handout')
  }
  if (claims.hum && claims.sub !== claims.own) {
    throw new AppError(
      403,
      'personal_credential_owner_only',
      'Gmail and Google Drive are only available in conversations you own',
    )
  }
  // The conversation token is only valid under its own /teams/:teamId.
  const teamId = claims.tid

  if (!(await teamGoogleClient(teamId))) {
    throw new AppError(
      409,
      'google_oauth_client_not_configured',
      'This team has not added a Google OAuth client. An administrator can add one in Team settings.',
    )
  }
  const personal = await personalGoogleToken(claims.own, provider, teamId)

  if (!personal) {
    throw new AppError(
      404,
      'personal_credential_not_connected',
      `This member has not connected ${provider === 'gmail' ? 'Gmail' : 'Google Drive'}. They can connect it in Settings → Personal Credentials.`,
    )
  }

  return c.json({
    token: personal.token,
    expiresAt: personal.expiresAt?.toISOString() ?? null,
    login: personal.login,
  })
})
