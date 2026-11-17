import { Hono } from 'hono'

import { AppError } from '@/lib/errors'
import { getNuphosUserById } from '@/lib/identity'
import {
  confirmTotpSetup,
  disableMfa,
  mfaStatus,
  regenerateRecoveryCodes,
  startTotpSetup,
  verifySecondFactor,
} from '@/lib/identity/mfa'
import { mfaChallengePasskeyOptions, verifyMfaChallenge } from '@/lib/identity/mfa-challenge'
import {
  addPasskey,
  passkeyRegistrationOptions,
  removePasskey,
  sessionPasskeyOptions,
} from '@/lib/identity/mfa-passkeys'
import { issueSession } from '@/lib/identity/start-session'
import { markVerified, requireRecentVerification } from '@/lib/identity/step-up'
import { requireAuth } from '@/middleware/auth'

import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

/**
 * Optional two-factor authentication (lib/identity/mfa.ts), mounted at
 * /auth/mfa. Managing it takes a sign-in session (cli-tokens.ts SESSION_ONLY);
 * turning it off or replacing the recovery codes also takes a current code,
 * and turning it on a recent sign-in, so a stolen session cannot lock the
 * owner out with an authenticator of its own.
 */
export const authMfa = new Hono<{ Variables: AuthVariables }>()

type Body = {
  code?: unknown
  passkey?: unknown
  mfaToken?: unknown
  response?: unknown
  name?: unknown
}

const body = async (c: Context) => ((await c.req.json().catch(() => null)) ?? {}) as Body

/** A code, or a passkey's answer to the last challenge it was given. */
const answer = (b: Body) => b.passkey ?? b.code

authMfa.get('/', requireAuth, async (c) => c.json(await mfaStatus(c.get('userId'))))

authMfa.post('/totp/setup', requireAuth, async (c) => {
  await requireRecentVerification(c.get('userId'), c.get('sessionId'), true)

  return c.json(await startTotpSetup(c.get('userId')))
})

authMfa.post('/totp/confirm', requireAuth, async (c) =>
  c.json(await confirmTotpSetup(c.get('userId'), answer(await body(c)))),
)

authMfa.post('/recovery-codes', requireAuth, async (c) =>
  c.json(await regenerateRecoveryCodes(c.get('userId'), answer(await body(c)))),
)

authMfa.post('/disable', requireAuth, async (c) => {
  await disableMfa(c.get('userId'), answer(await body(c)))

  return c.body(null, 204)
})

// Step-up: a current code makes this session recently verified again.
authMfa.post('/reauth', requireAuth, async (c) => {
  const sessionId = c.get('sessionId')

  if (!sessionId) throw new AppError(403, 'session_required', 'Sign in again to continue')
  await verifySecondFactor(c.get('userId'), answer(await body(c)))
  await markVerified(sessionId)

  return c.body(null, 204)
})

// The second step of any sign-in that ended in `mfa_required`. Public, like
// the sign-in it completes: the challenge token is the credential.
authMfa.post('/verify', async (c) => {
  const sent = await body(c)
  const { userId, viaWebsite } = await verifyMfaChallenge(sent.mfaToken, answer(sent))
  const user = await getNuphosUserById(userId)

  if (!user) throw new AppError(401, 'unauthorized', 'Account is no longer available')

  return c.json(await issueSession(c, user, viaWebsite))
})

// To finish a sign-in with a passkey: options bound to its challenge. Public, like /verify.
authMfa.post('/verify/options', async (c) =>
  c.json(await mfaChallengePasskeyOptions((await body(c)).mfaToken)),
)

// A passkey challenge for this session: step-up, turning off, new recovery codes.
authMfa.post('/passkey-options', requireAuth, async (c) =>
  c.json(await sessionPasskeyOptions(c.get('userId'))),
)

// Adding a passkey is adding a second factor, so it takes a recent check.
authMfa.post('/passkeys/options', requireAuth, async (c) => {
  await requireRecentVerification(c.get('userId'), c.get('sessionId'))

  return c.json(await passkeyRegistrationOptions(c.get('userId')))
})

authMfa.post('/passkeys', requireAuth, async (c) => {
  await requireRecentVerification(c.get('userId'), c.get('sessionId'))
  const { response, name } = await body(c)

  return c.json({ passkey: await addPasskey(c.get('userId'), response, name) })
})

authMfa.delete('/passkeys/:id', requireAuth, async (c) => {
  await verifySecondFactor(c.get('userId'), answer(await body(c)))
  if (!(await removePasskey(c.get('userId'), c.req.param('id')))) {
    throw new AppError(404, 'not_found', 'No such passkey')
  }

  return c.body(null, 204)
})
