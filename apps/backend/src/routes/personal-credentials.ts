import { Hono } from 'hono'

import { desktopCallbackResponse } from '@/lib/desktop-callback-page'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import {
  claimPersonalCredential,
  deletePersonalCredential,
  listPersonalCredentials,
  PERSONAL_CREDENTIAL_PROVIDERS,
  stagePersonalCredentialOAuth,
  startPersonalCredentialOAuth,
} from '@/lib/personal-credentials'
import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'
import type { PersonalCredentialProvider } from '@/models'

// A member's own GitHub / Linear grants. Only a signed-in user session reaches
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

personalCredentialRoutes.post('/:provider/start', requireAuth, async (c) =>
  c.json(
    await startPersonalCredentialOAuth(c.get('userId'), providerParam(c.req.param('provider'))),
  ),
)

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
  await deletePersonalCredential(c.get('userId'), providerParam(c.req.param('provider')))

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
