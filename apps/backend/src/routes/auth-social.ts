import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { AppError } from '@/lib/errors'
import { authenticateToken } from '@/lib/identity/auth'
import { FIRST_TOUCH_COOKIE, recordSignupSource } from '@/lib/identity/signup-source'
import { exchangeSocialCode, providerSettings, signInSocial } from '@/lib/identity/social'
import { socialAuthAttempts as attempts } from '@/lib/identity/social-store'
import { startSession } from '@/lib/identity/start-session'
import {
  abandonNativeSession,
  completeNativeSession,
  findPendingNativeSession,
} from '@/lib/native-auth'
import { generateOpaqueToken, hashToken, safeEqualStr } from '@/lib/oauth/tokens'

import type { SocialProvider } from '@/lib/identity/social'

export const socialAuth = new Hono()
socialAuth.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  )
  await next()
})

socialAuth.get('/login', async (c) => {
  const handle = c.req.query('handle')

  if (handle && !(await findPendingNativeSession(handle)))
    throw new AppError(400, 'invalid_handle', 'Start sign-in again from the app')
  const suffix = handle ? `?handle=${encodeURIComponent(handle)}` : ''
  // Only configured providers are offered; with none, clients fall back to their legacy sign-in.
  const providers = (['google', 'apple'] as const).filter((provider) => isConfigured(provider))
  const links = providers.map(
    (p) => `<a href="${p}/start${suffix}">Continue with ${p === 'google' ? 'Google' : 'Apple'}</a>`,
  )

  if (!links.length)
    throw new AppError(503, 'provider_unavailable', 'Social sign-in is not configured')
  c.header('X-Nuphos-Social-Login', '1')
  // Lets apps show one button per provider and skip this page.
  c.header('X-Nuphos-Social-Providers', providers.join(','))

  return c.html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in to Nuphos</title><style>body{font:18px system-ui;max-width:360px;margin:15vh auto;padding:24px}a{display:block;padding:16px;margin:16px 0;border:1px solid;border-radius:8px;color:inherit;text-decoration:none}</style><h1>Sign in to Nuphos</h1>${links.join('')}<p>Use the same provider as your existing account.</p></html>`,
  )
})

socialAuth.get('/session', async (c) => {
  const token = getCookie(c, '__Host-nuphos-social')
  const identity = token ? await authenticateToken(token) : null

  if (!identity) throw new AppError(401, 'unauthorized', 'Sign in first')

  return c.json({ user: identity.user })
})

socialAuth.get('/:provider/start', async (c) => {
  const provider = parseProvider(c.req.param('provider'))
  const settings = providerSettings(provider)
  const handle = c.req.query('handle')

  if (handle && !(await findPendingNativeSession(handle)))
    throw new AppError(400, 'invalid_handle', 'Start sign-in again from the app')
  const state = generateOpaqueToken()
  const nonce = generateOpaqueToken()

  await attempts().insertOne({
    _id: hashToken(state),
    provider,
    nonce,
    handle,
    // Read here: Apple's callback is a cross-site POST, which drops Lax cookies.
    firstTouch: getCookie(c, FIRST_TOUCH_COOKIE),
    expiresAt: new Date(Date.now() + 600_000),
  })
  setCookie(c, '__Host-nuphos-oauth', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    path: '/',
    maxAge: 600,
  })
  const url = new URL(settings.authorize)

  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: 'code',
    scope: provider === 'apple' ? 'name email' : 'openid email profile',
    state,
    nonce,
    ...(provider === 'apple' ? { response_mode: 'form_post' } : {}),
  }).toString()

  return c.redirect(url.toString())
})

socialAuth.on(['GET', 'POST'], '/:provider/callback', async (c) => {
  const provider = parseProvider(c.req.param('provider'))
  const input = c.req.method === 'POST' ? await c.req.parseBody() : c.req.query()
  const state = input.state
  const cookie = getCookie(c, '__Host-nuphos-oauth')

  if (typeof state !== 'string' || !cookie || !safeEqualStr(state, cookie))
    throw new AppError(400, 'invalid_state', 'Sign-in expired. Please try again.')
  const attempt = await attempts().findOneAndDelete({
    _id: hashToken(state),
    provider,
    expiresAt: { $gt: new Date() },
  })

  deleteCookie(c, '__Host-nuphos-oauth', { path: '/', secure: true })
  if (!attempt) throw new AppError(400, 'invalid_state', 'Sign-in expired. Please try again.')
  const delivery = attempt.handle ? await findPendingNativeSession(attempt.handle) : null

  if (attempt.handle && !delivery)
    throw new AppError(400, 'invalid_handle', 'Start sign-in again from the app')
  try {
    if (typeof input.code !== 'string' || !input.code || input.error)
      throw new Error('Provider sign-in was cancelled')
    const identity = await signInSocial(
      provider,
      await exchangeSocialCode(provider, input.code, attempt.nonce),
    )

    await recordSignupSource(identity.user, provider, attempt.firstTouch)

    if (attempt.handle && delivery) {
      const completed = await completeNativeSession(attempt.handle, identity.user.id)

      if (!completed) throw new Error('Sign-in expired')
      const target = new URL(delivery.redirectUri)

      target.searchParams.set('code', completed.deliveryCode)
      if (delivery.clientState) target.searchParams.set('state', delivery.clientState)

      return c.redirect(target.toString())
    }
    const session = await startSession(c, identity.user)

    setCookie(c, '__Host-nuphos-social', session.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })

    return c.html(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Signed in</title><h1>Signed in to Nuphos</h1><p>You can return to your workspace.</p></html>',
    )
  } catch {
    if (attempt.handle) await abandonNativeSession(attempt.handle)
    if (delivery) {
      const target = new URL(delivery.redirectUri)

      target.searchParams.set('error', 'sign_in_failed')
      if (delivery.clientState) target.searchParams.set('state', delivery.clientState)

      return c.redirect(target.toString())
    }
    throw new AppError(
      401,
      'sign_in_failed',
      'Sign-in failed. Use your existing account method or try again.',
    )
  }
})

function isConfigured(provider: SocialProvider) {
  try {
    return Boolean(providerSettings(provider))
  } catch {
    return false
  }
}

function parseProvider(raw: string): SocialProvider {
  if (raw !== 'google' && raw !== 'apple')
    throw new AppError(404, 'unknown_provider', 'Unknown sign-in provider')

  return raw
}
