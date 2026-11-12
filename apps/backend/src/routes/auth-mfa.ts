import { Hono } from 'hono'

import { AppError } from '@/lib/errors'
import { getNuphosUserById } from '@/lib/identity'
import {
  confirmTotpSetup,
  disableMfa,
  mfaStatus,
  regenerateRecoveryCodes,
  startTotpSetup,
  verifyMfaChallenge,
} from '@/lib/identity/mfa'
import { issueSession } from '@/lib/identity/start-session'
import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

/**
 * Optional two-factor authentication (lib/identity/mfa.ts), mounted at
 * /auth/mfa. Managing it takes a sign-in session (cli-tokens.ts SESSION_ONLY);
 * turning it off or replacing the recovery codes also takes a current code.
 */
export const authMfa = new Hono<{ Variables: AuthVariables }>()

const body = async (c: Context) =>
  ((await c.req.json().catch(() => null)) ?? {}) as { code?: unknown; mfaToken?: unknown }

authMfa.get('/', requireAuth, async (c) => c.json(await mfaStatus(c.get('userId'))))

authMfa.post('/totp/setup', requireAuth, async (c) => c.json(await startTotpSetup(c.get('userId'))))

authMfa.post('/totp/confirm', requireAuth, async (c) =>
  c.json(await confirmTotpSetup(c.get('userId'), (await body(c)).code)),
)

authMfa.post('/recovery-codes', requireAuth, async (c) =>
  c.json(await regenerateRecoveryCodes(c.get('userId'), (await body(c)).code)),
)

authMfa.post('/disable', requireAuth, async (c) => {
  await disableMfa(c.get('userId'), (await body(c)).code)

  return c.body(null, 204)
})

// The second step of any sign-in that ended in `mfa_required`. Public, like
// the sign-in it completes: the challenge token is the credential.
authMfa.post('/verify', async (c) => {
  const { mfaToken, code } = await body(c)
  const user = await getNuphosUserById(await verifyMfaChallenge(mfaToken, code))

  if (!user) throw new AppError(401, 'unauthorized', 'Account is no longer available')

  return c.json(await issueSession(c, user))
})
