import { Hono } from 'hono'

import type { NativeDeliveryTarget } from '@/lib/native-auth'
import type { AuthVariables } from '@/middleware/auth'

import { requestEmailOtp, verifyEmailOtp } from '@/lib/email-otp'
import { AppError } from '@/lib/errors'
import { signInWithGoogleCode } from '@/lib/identity'
import { getDeletionRequest, requestAccountDeletion } from '@/lib/identity/account-deletion'
import { readAIConsent, saveAIConsent } from '@/lib/identity/ai-consent'
import { signInWithPassword, setPasswordWithEmailCode } from '@/lib/identity/password'
import { updateProfile } from '@/lib/identity/profile'
import {
  abandonNativeSession,
  completeNativeSession,
  findNativeDeliveryTarget,
  findPendingNativeSession,
  redeemNativeSession,
  registerNativeSession,
} from '@/lib/native-auth'
import { requireAuth } from '@/middleware/auth'

export const auth = new Hono<{ Variables: AuthVariables }>()

auth.get('/me', requireAuth, (c) => {
  return c.json(c.get('user'))
})

auth.get('/account-deletion', requireAuth, async (c) =>
  c.json(await getDeletionRequest(c.get('userId'))),
)

auth.post('/account-deletion', requireAuth, async (c) =>
  c.json(await requestAccountDeletion(c.get('user'), await c.req.json().catch(() => null)), 202),
)

auth.get('/ai-consent', requireAuth, async (c) => c.json(await readAIConsent(c.get('userId'))))

auth.put('/ai-consent', requireAuth, async (c) =>
  c.json(await saveAIConsent(c.get('userId'), await c.req.json().catch(() => null))),
)

auth.patch('/me', requireAuth, async (c) =>
  c.json(await updateProfile(c.get('userId'), await c.req.json())),
)

auth.post('/password/sign-in', async (c) =>
  c.json(await signInWithPassword(await c.req.json().catch(() => null))),
)

auth.post('/password/set', async (c) =>
  c.json(await setPasswordWithEmailCode(await c.req.json().catch(() => null))),
)

// Email OTP sign-in/sign-up for teams not on Google Workspace. Errors follow
// the AppError envelope (unlike /google/sign-in, whose GraphQL-ish shape is
// what the external web login page expects).
auth.post('/email/request-code', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email : ''

  await requestEmailOtp(email)

  return c.json({ ok: true })
})

auth.post('/email/verify-code', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    email?: unknown
    code?: unknown
  } | null
  const email = typeof body?.email === 'string' ? body.email : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const { token, user } = await verifyEmailOtp(email, code)

  return c.json({ token, user })
})

// ── Native-app sign-in (RFC 8252). These endpoints are unauthenticated by
// necessity — see lib/native-auth.ts for why that is safe. ──

auth.post('/native/session', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  const { handle, expiresInSec } = await registerNativeSession({
    redirectUri: body?.redirectUri,
    codeChallenge: body?.codeChallenge,
    codeChallengeMethod: body?.codeChallengeMethod,
    clientState: body?.clientState,
  })

  return c.json({ handle, expiresInSec }, 201)
})

// Strictly less powerful than redeem — see findNativeDeliveryTarget for the
// invariants that keep it that way. POST, and the handle in the body rather
// than the path, so it stays out of access logs and Referer headers.
auth.post('/native/session/delivery', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  const delivery = await findNativeDeliveryTarget(body?.handle)

  if (!delivery) {
    throw new AppError(404, 'invalid_handle', 'This sign-in request is no longer valid')
  }

  return c.json(delivery)
})

auth.post('/native/session/redeem', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  const { token, user } = await redeemNativeSession(body?.handle, body?.codeVerifier, body?.code)

  return c.json({ token, user })
})

auth.post('/google/sign-in', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    code?: unknown
    redirectUri?: unknown
    handle?: unknown
  } | null
  const code = typeof body?.code === 'string' ? body.code : null
  const redirectUri = typeof body?.redirectUri === 'string' ? body.redirectUri : undefined
  const handle = typeof body?.handle === 'string' && body.handle !== '' ? body.handle : undefined

  if (!code || !redirectUri) {
    return c.json(
      {
        errors: [
          {
            message: 'Failed to sign in',
            extensions: {
              description: !code
                ? 'Missing Google authorization code'
                : 'Missing Google redirect URI',
            },
          },
        ],
      },
      400,
    )
  }

  // Resolved up front so both the success and the failure path below can send
  // the browser back to the app.
  let delivery: NativeDeliveryTarget | null = null

  if (handle) {
    delivery = await findPendingNativeSession(handle)
    if (!delivery) {
      return c.json(
        {
          errors: [
            {
              message: 'Failed to sign in',
              extensions: {
                description: 'This sign-in request has expired — please try again from the app',
              },
            },
          ],
        },
        400,
      )
    }
  }

  try {
    const { token, user } = await signInWithGoogleCode(code, redirectUri)

    if (handle && delivery) {
      // The token is deliberately dropped here: the app mints a fresh one by
      // redeeming, so neither the landing page nor the browser sees a credential.
      const completed = await completeNativeSession(handle, user.id)

      if (!completed) {
        return c.json(
          {
            errors: [
              {
                message: 'Failed to sign in',
                extensions: {
                  description: 'This sign-in request has expired — please try again from the app',
                },
              },
            ],
            nativeDelivery: delivery,
          },
          400,
        )
      }

      // `code` must reach the app only via the loopback redirect — it is what
      // proves the redeemer is the machine that just authenticated.
      return c.json({
        // The browser still never sees a credential, but the public user id is
        // needed by nuphos.ai to merge the anonymous download visitor into the
        // same PostHog person the desktop app identifies after redemption.
        data: { googleSignIn: { user: { id: user.id } } },
        nativeDelivery: { ...delivery, code: completed.deliveryCode },
      })
    }

    return c.json({
      data: {
        googleSignIn: {
          token,
          user,
        },
      },
    })
  } catch (e) {
    if (handle) await abandonNativeSession(handle)

    return c.json(
      {
        errors: [
          {
            message: 'Failed to sign in',
            extensions: { description: e instanceof Error ? e.message : String(e) },
          },
        ],
        // Lets the landing page bounce the browser back to the app with the
        // failure, rather than leave it waiting on a listener nothing will hit.
        ...(delivery ? { nativeDelivery: delivery } : {}),
      },
      400,
    )
  }
})
