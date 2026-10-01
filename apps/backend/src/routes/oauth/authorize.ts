import { authenticateUserFromCookies } from '@/lib/cookie-auth'
import { requestEmailOtp, verifyEmailOtp } from '@/lib/email-otp'
import { getClient, issueAuthCode } from '@/lib/oauth/store'
import { signConsentToken, verifyConsentToken } from '@/lib/oauth/tokens'
import { redirectBackWithError, validateAuthorize } from '@/routes/oauth/authorize-validate'
import { consentPage, oneClickConsentPage } from '@/routes/oauth/consent-pages'
import { CONSENT_TOKEN_TTL_SEC, consentPageHeaders, escapeHtml } from '@/routes/oauth/shared'

import type { Hono } from 'hono'

export function registerOauthAuthorizeRoutes(oauthRoutes: Hono) {
  // GET /oauth/authorize — render consent + login.
  oauthRoutes.get('/authorize', async (c) => {
    const q = c.req.query()
    const validation = await validateAuthorize({
      responseType: q.response_type ?? '',
      clientId: q.client_id ?? '',
      redirectUri: q.redirect_uri ?? '',
      state: q.state ?? '',
      scope: q.scope ?? '',
      codeChallenge: q.code_challenge ?? '',
      codeChallengeMethod: q.code_challenge_method ?? '',
      resource: q.resource ?? '',
    })

    consentPageHeaders(c)
    if (!validation.ok) {
      if (validation.safe && q.redirect_uri) {
        return c.redirect(
          redirectBackWithError(
            q.redirect_uri,
            q.state ?? '',
            validation.error,
            validation.description,
          ),
        )
      }

      return c.html(
        `<p>${escapeHtml(validation.error)}: ${escapeHtml(validation.description)}</p>`,
        400,
      )
    }

    const client = await getClient(validation.params.clientId)

    // A browser that already carries a valid Nuphos session skips the OTP and
    // gets a one-click Authorize button. `prompt=login` forces the login form.
    if (c.req.query('prompt') !== 'login') {
      const cookieUser = await authenticateUserFromCookies(c.req.header('Cookie'))

      if (cookieUser) {
        return c.html(
          oneClickConsentPage(validation.params, {
            clientName: client?.clientName ?? null,
            email: cookieUser.email,
            consentToken: signConsentToken({
              userId: cookieUser.id,
              clientId: validation.params.clientId,
              ttlSec: CONSENT_TOKEN_TTL_SEC,
            }),
          }),
        )
      }
    }

    return c.html(consentPage(validation.params, { clientName: client?.clientName ?? null }))
  })

  // POST /oauth/authorize/email — send the OTP to the entered address.
  oauthRoutes.post('/authorize/email', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null
    const email = typeof body?.email === 'string' ? body.email : ''

    if (!email) return c.json({ error: 'invalid_request' }, 400)
    try {
      await requestEmailOtp(email)
    } catch {
      // Don't leak whether the address exists / is configured; the page shows a
      // generic result either way.
    }

    return c.json({ ok: true })
  })

  // POST /oauth/authorize — verify OTP, mint the code, redirect back.
  oauthRoutes.post('/authorize', async (c) => {
    const form = await c.req.parseBody()
    const get = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '')

    const validation = await validateAuthorize({
      responseType: get('response_type'),
      clientId: get('client_id'),
      redirectUri: get('redirect_uri'),
      state: get('state'),
      scope: get('scope'),
      codeChallenge: get('code_challenge'),
      codeChallengeMethod: get('code_challenge_method'),
      resource: get('resource'),
    })

    consentPageHeaders(c)
    if (!validation.ok) {
      if (validation.safe && get('redirect_uri')) {
        return c.redirect(
          redirectBackWithError(
            get('redirect_uri'),
            get('state'),
            validation.error,
            validation.description,
          ),
        )
      }

      return c.html(
        `<p>${escapeHtml(validation.error)}: ${escapeHtml(validation.description)}</p>`,
        400,
      )
    }

    let userId: string
    const consentToken = get('consent_token')

    if (consentToken) {
      // Cookie-session consent: re-authenticate the cookie and check the CSRF
      // token binds to this user + client and hasn't expired.
      const cookieUser = await authenticateUserFromCookies(c.req.header('Cookie'))

      if (
        !cookieUser ||
        !verifyConsentToken(consentToken, cookieUser.id, validation.params.clientId)
      ) {
        const client = await getClient(validation.params.clientId)

        return c.html(
          consentPage(validation.params, {
            clientName: client?.clientName ?? null,
            error: 'Your session could not be verified. Sign in with your email to continue.',
          }),
          400,
        )
      }
      userId = cookieUser.id
    } else {
      const email = get('email')
      const code = get('code')

      try {
        const result = await verifyEmailOtp(email, code)

        userId = result.user.id
      } catch {
        const client = await getClient(validation.params.clientId)

        return c.html(
          consentPage(validation.params, {
            clientName: client?.clientName ?? null,
            error: 'Incorrect or expired code. Request a new one and try again.',
          }),
          400,
        )
      }
    }

    const authCode = await issueAuthCode({
      clientId: validation.params.clientId,
      userId,
      redirectUri: validation.params.redirectUri,
      codeChallenge: validation.params.codeChallenge,
      scope: validation.params.scope,
      resource: validation.params.resource,
    })

    const url = new URL(validation.params.redirectUri)

    url.searchParams.set('code', authCode)
    if (validation.params.state) url.searchParams.set('state', validation.params.state)

    return c.redirect(url.toString())
  })
}
