import { Hono } from 'hono'
import { z } from 'zod'

import { config } from '@/config'
import { credentialSource, getConversationBySessionId } from '@/lib/agent/db'
import { verifyPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { getNuphosUserById } from '@/lib/identity'
import { isTokenRevoked } from '@/lib/internal-token/revocation'
import { logError } from '@/lib/observability'
import {
  claimPersonalCredential,
  deletePersonalCredential,
  listPersonalCredentials,
  PERSONAL_CREDENTIAL_PROVIDERS,
  googleCredentialFor,
  personalGoogleTokenOf,
  personalOwnToken,
  stagePersonalCredentialOAuth,
  startPersonalCredentialOAuth,
} from '@/lib/personal-credentials'
import {
  composioToolProvider,
  composioUserId,
  executeComposioTool,
} from '@/lib/personal-credentials/composio'
import { NAMES } from '@/lib/personal-credentials/exchange'
import { isGoogleProvider, teamGoogleClient } from '@/lib/personal-credentials/google'
import { zv } from '@/lib/validate'
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
    c.req.query('connectionId'),
  )

  return c.body(null, 204)
})

// Public: the provider redirects the browser here. The state ties the code to
// the member who started the flow; it is single-use and expires in 10 minutes.
personalCredentialRoutes.get('/:provider/callback', async (c) => {
  const provider = providerParam(c.req.param('provider'))
  const state = c.req.query('state') ?? ''
  const code = c.req.query('code') ?? ''
  // Composio returns with status and connected_account_id instead of a code.
  const composio = c.req.query('status')
  const error = c.req.query('error') ?? (composio === 'failed' ? 'access_denied' : undefined)
  const back = (params: Record<string, string>) =>
    desktopCallbackResponse(c, DESKTOP_RETURN, params)

  if (!state || error || (!code && composio !== 'success')) {
    return back({ provider, error: error ?? 'missing_code' })
  }
  try {
    return back({ provider, ...(await stagePersonalCredentialOAuth(provider, state, code)) })
  } catch (error) {
    logError('personal_credential.callback_failed', error, { provider })

    return back({ provider, error: error instanceof AppError ? error.code : 'exchange_failed' })
  }
})

// Mounted under /teams/:teamId for conversation tokens: the agent's handout of a
// member's own grant. It is always the session owner's own, and a teammate's
// message in that session gets none: a shared session may run on someone else's
// runtime, so the grant never leaves its owner's sessions. Every one follows the
// conversation's selection (personalCredentialIds) as connectors do; Google grants are
// also issued by this team's OAuth client (or Composio), GitHub and Linear need
// no team binding.
export const personalCredentialTokenRoutes = new Hono()

/** The conversation token's claims, when its owner is asking and selected `provider`. */
async function ownerClaims(authorization: string, provider: PersonalCredentialProvider) {
  const what = `Your own ${NAMES[provider]} credential`
  const claims = authorization.startsWith('Bearer ')
    ? verifyPreviewMcpToken(authorization.slice('Bearer '.length))
    : null

  if (!claims || (await isTokenRevoked(claims))) {
    throw new AppError(403, 'forbidden', 'Only an agent conversation can use this handout')
  }
  // An exchanged token vends only the credentials it names; a member's own grants are not among them.
  if (claims.lim) {
    throw new AppError(403, 'forbidden', 'This token is limited to other credentials')
  }
  if (claims.hum && claims.sub !== claims.own) {
    throw new AppError(
      403,
      'personal_credential_owner_only',
      `${what} is only available in conversations you own`,
    )
  }
  const conversation = await getConversationBySessionId(claims.sid)
  const access = conversation && (await credentialSource(conversation)).credentialAccess
  const ids = access?.personalCredentialIds

  // As for connectors, a conversation with no list keeps its reach.
  if (conversation?.userId !== claims.own || (ids && !ids.includes(provider))) {
    throw new AppError(
      403,
      'personal_credential_not_selected',
      `${what} is not selected for this conversation`,
    )
  }

  return { ...claims, connectionIds: access?.personalConnectionIds }
}

const notConnected = (name: string) =>
  new AppError(
    404,
    'personal_credential_not_connected',
    `This member has not connected ${name}. They can connect it in Settings → Personal Credentials.`,
  )

const handedOut = (personal: { token: string; expiresAt: Date | null; login: string }) => ({
  token: personal.token,
  expiresAt: personal.expiresAt?.toISOString() ?? null,
  login: personal.login,
})

personalCredentialTokenRoutes.get('/:provider/token', async (c) => {
  const provider = c.req.param('provider')
  const authorization = c.req.header('Authorization') ?? ''

  if (provider === 'github' || provider === 'linear') {
    const claims = await ownerClaims(authorization, provider)
    const personal = await personalOwnToken(
      claims.own,
      provider,
      c.req.query('connectionId'),
      claims.connectionIds,
    )

    if (!personal) throw notConnected(NAMES[provider])
    // In the shape each skill's setup script already reads for the team handout.
    if (provider === 'linear')
      return c.json({ ...handedOut(personal), accessToken: personal.token })
    const owner = await getNuphosUserById(claims.own)

    return c.json({
      ...handedOut(personal),
      accountLogin: personal.login,
      actor: { kind: 'personal', login: personal.login },
      commitCoAuthor: owner ? { name: owner.name, email: owner.email } : null,
    })
  }
  if (!isGoogleProvider(provider)) {
    throw new AppError(404, 'not_found', 'Unknown Personal Credential provider')
  }
  const claims = await ownerClaims(authorization, provider)
  // The conversation token is only valid under its own /teams/:teamId.
  const teamId = claims.tid

  if (!config.byos.composio.apiKey && !(await teamGoogleClient(teamId))) {
    throw new AppError(
      409,
      'google_oauth_client_not_configured',
      'This team has not added a Google OAuth client. An administrator can add one in Team settings.',
    )
  }
  const credential = await googleCredentialFor(
    claims.own,
    provider,
    teamId,
    c.req.query('connectionId'),
    claims.connectionIds,
  )

  if (credential?.composioAccountId) {
    throw new AppError(
      409,
      'personal_credential_via_composio',
      'This member connected through Composio: run Google tools with POST /teams/:teamId/composio/execute',
    )
  }
  const personal = credential && (await personalGoogleTokenOf(credential))

  if (!personal) throw notConnected(NAMES[provider])

  return c.json(handedOut(personal))
})

// Mounted under /teams/:teamId for conversation tokens: runs one Gmail or
// Google Drive tool through the session owner's own Composio connection in
// this team. The Composio API key never leaves the backend.
export const composioRoutes = new Hono()

const executeSchema = z
  .object({
    tool: z.string().max(100),
    arguments: z.record(z.string(), z.unknown()).default({}),
    // Which of the member's connected accounts to run as; optional only while there is one.
    connectionId: z.string().max(40).optional(),
  })
  .strict()

composioRoutes.post('/execute', zv('json', executeSchema), async (c) => {
  const { tool, arguments: args, connectionId } = c.req.valid('json')
  const provider = composioToolProvider(tool)

  if (!provider) {
    throw new AppError(
      400,
      'tool_not_allowed',
      'Only Gmail, Google Drive and Google Calendar event tools, other than permanent mail deletion, can run here',
    )
  }
  const claims = await ownerClaims(c.req.header('Authorization') ?? '', provider)
  const credential = await googleCredentialFor(
    claims.own,
    provider,
    claims.tid,
    connectionId,
    claims.connectionIds,
    true,
  )

  if (!credential?.composioAccountId) {
    throw notConnected(NAMES[provider])
  }

  return c.json(
    await executeComposioTool({
      tool,
      connectedAccountId: credential.composioAccountId,
      composioUserId: composioUserId(claims.tid, claims.own),
      arguments: args,
    }),
  )
})
