import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'

import type { NuphosUser } from '@/lib/identity'
import type { NativeDeliveryTarget } from '@/lib/native-auth'
import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

import { redeemDeviceJoinToken } from '@/lib/agent/devices/join-tokens'
import { requestEmailOtp, verifyEmailOtp } from '@/lib/email-otp'
import { clientIp, signInSource } from '@/lib/request-origin'
import { AppError } from '@/lib/errors'
import { signInWithGoogleCode } from '@/lib/identity'
import { getDeletionRequest, requestAccountDeletion } from '@/lib/identity/account-deletion'
import { readAIConsent, saveAIConsent } from '@/lib/identity/ai-consent'
import { MAX_AVATAR_UPLOAD_BYTES, removeAvatar, uploadAvatar } from '@/lib/identity/avatar-upload'
import { signInWithPassword, setPasswordWithEmailCode } from '@/lib/identity/password'
import { updateProfile } from '@/lib/identity/profile'
import { createUserSession } from '@/lib/identity/sessions'
import { isNewSignIn, sendNewSignInAlert } from '@/lib/identity/sign-in-alert'
import {
  abandonNativeSession,
  completeNativeSession,
  findNativeDeliveryTarget,
  findPendingNativeSession,
  redeemNativeSession,
  registerNativeSession,
} from '@/lib/native-auth'
import { zv } from '@/lib/validate'
import * as authMiddleware from '@/middleware/auth'
import { authSessions } from '@/routes/auth-sessions'

// Read per request, not captured when this module loads: a suite that loads
// this router before another registers its @/middleware/auth double would
// otherwise pin the real check here for every later suite in the process.
const requireAuth: typeof authMiddleware.requireAuth = (c, next) =>
  authMiddleware.requireAuth(c, next)

export const auth = new Hono<{ Variables: AuthVariables }>()

// Every sign-in starts its session here. `viaWebsite`: nuphos.ai's server made
// the call, so the address seen is the website's, not the visitor's.
async function startSession(c: Context, user: NuphosUser, viaWebsite = false) {
  const seen = signInSource((name) => c.req.header(name))
  const source = viaWebsite ? { client: seen.client, userAgent: seen.userAgent } : seen
  // Compared with the account's other sessions before this one joins them.
  const isNew = await isNewSignIn(user, source)
  const token = await createUserSession(user.id, source)

  if (isNew) void sendNewSignInAlert(user, source)

  return { token, user }
}

auth.route('/sessions', authSessions)

auth.get('/me', requireAuth, (c) => {
  const cliToken = c.get('cliToken')

  return c.json({ ...c.get('user'), ...(cliToken ? { cliToken } : {}) })
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

export const avatarBodyLimit = bodyLimit({
  maxSize: MAX_AVATAR_UPLOAD_BYTES,
  onError: (c) =>
    c.json(
      {
        error: {
          code: 'avatar_too_large',
          message: 'Use an image under 2 MB',
          requestId: c.get('requestId'),
        },
      },
      413,
    ),
})

auth.put('/me/avatar', requireAuth, avatarBodyLimit, async (c) =>
  c.json(await uploadAvatar(c.get('userId'), new Uint8Array(await c.req.arrayBuffer()))),
)

auth.delete('/me/avatar', requireAuth, async (c) => c.json(await removeAvatar(c.get('userId'))))

auth.post('/password/sign-in', async (c) =>
  c.json(await startSession(c, await signInWithPassword(await c.req.json().catch(() => null)))),
)

auth.post('/password/set', async (c) =>
  c.json(
    await startSession(c, await setPasswordWithEmailCode(await c.req.json().catch(() => null))),
  ),
)

// Email OTP sign-in/sign-up for teams not on Google Workspace. Errors follow
// the AppError envelope (unlike /google/sign-in, whose GraphQL-ish shape is
// what the external web login page expects).
auth.post('/email/request-code', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email : ''

  await requestEmailOtp(
    email,
    clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')),
    signInSource((name) => c.req.header(name)),
  )

  return c.json({ ok: true })
})

auth.post('/email/verify-code', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    email?: unknown
    code?: unknown
  } | null
  const email = typeof body?.email === 'string' ? body.email : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''

  return c.json(await startSession(c, await verifyEmailOtp(email, code)))
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
  const user = await redeemNativeSession(body?.handle, body?.codeVerifier, body?.code)

  return c.json(await startSession(c, user))
})

// `nuphos agent --join`: a one-time token from the device's owner becomes a
// credential for this device alone. No session is involved, so this stays public.
const deviceJoinSchema = z.object({
  token: z.string().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(64),
})

auth.post('/devices/join', zv('json', deviceJoinSchema), async (c) => {
  const { token, ...device } = c.req.valid('json')
  const joined = await redeemDeviceJoinToken(token, device)

  if (!joined) {
    throw new AppError(401, 'invalid_join_token', 'This join token is invalid, used or expired')
  }

  return c.json(joined, 201)
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
    const user = await signInWithGoogleCode(code, redirectUri)

    if (handle && delivery) {
      // No session here: the app starts its own by redeeming, so neither the
      // landing page nor the browser sees a credential.
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

    // Without a handle, only the nuphos.ai website's server calls this.
    return c.json({ data: { googleSignIn: await startSession(c, user, true) } })
  } catch (e) {
    if (handle) await abandonNativeSession(handle)

    return c.json(
      {
        errors: [
          {
            message: 'Failed to sign in',
            extensions: {
              description: e instanceof Error ? e.message : String(e),
              ...(e instanceof AppError ? { code: e.code } : {}),
            },
          },
        ],
        // Lets the landing page bounce the browser back to the app with the
        // failure, rather than leave it waiting on a listener nothing will hit.
        ...(delivery ? { nativeDelivery: delivery } : {}),
      },
      e instanceof AppError && e.status === 403 ? 403 : 400,
    )
  }
})
