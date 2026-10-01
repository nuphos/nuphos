import { consumeAuthCode, consumeRefreshToken, issueRefreshToken } from '@/lib/oauth/store'
import { signAccessToken, verifyPkceS256 } from '@/lib/oauth/tokens'
import { ACCESS_TOKEN_TTL_SEC, baseUrl } from '@/routes/oauth/shared'

import type { Context, Hono } from 'hono'

// ─── Token endpoint ─────────────────────────────────────────────────────────

function tokenError(c: Context, error: string, description: string) {
  return c.json({ error, error_description: description }, 400)
}

export function registerOauthTokenRoute(oauthRoutes: Hono) {
  oauthRoutes.post('/token', async (c) => {
    // RFC 6749 §5.1: responses carrying tokens must not be cached.
    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    const form = await c.req.parseBody()
    const get = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '')
    const grantType = get('grant_type')

    if (grantType === 'authorization_code') {
      const code = get('code')
      const clientId = get('client_id')
      const redirectUri = get('redirect_uri')
      const codeVerifier = get('code_verifier')

      if (!code || !clientId || !redirectUri || !codeVerifier) {
        return tokenError(
          c,
          'invalid_request',
          'Missing code, client_id, redirect_uri, or code_verifier',
        )
      }

      const record = await consumeAuthCode(code)

      if (!record) return tokenError(c, 'invalid_grant', 'Authorization code is invalid or expired')
      if (record.clientId !== clientId) return tokenError(c, 'invalid_grant', 'client_id mismatch')
      if (record.redirectUri !== redirectUri)
        return tokenError(c, 'invalid_grant', 'redirect_uri mismatch')
      if (!verifyPkceS256(codeVerifier, record.codeChallenge)) {
        return tokenError(c, 'invalid_grant', 'PKCE verification failed')
      }

      const accessToken = signAccessToken({
        userId: record.userId,
        clientId: record.clientId,
        resource: record.resource,
        issuer: baseUrl(),
        scope: record.scope,
        ttlSec: ACCESS_TOKEN_TTL_SEC,
      })
      const refreshToken = await issueRefreshToken({
        clientId: record.clientId,
        userId: record.userId,
        scope: record.scope,
        resource: record.resource,
      })

      return c.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SEC,
        refresh_token: refreshToken,
        scope: record.scope,
      })
    }

    if (grantType === 'refresh_token') {
      const clientId = get('client_id')
      const refreshToken = get('refresh_token')

      if (!clientId || !refreshToken) {
        return tokenError(c, 'invalid_request', 'Missing client_id or refresh_token')
      }
      const record = await consumeRefreshToken(refreshToken)

      if (!record) return tokenError(c, 'invalid_grant', 'Refresh token is invalid or expired')
      if (record.clientId !== clientId) return tokenError(c, 'invalid_grant', 'client_id mismatch')

      const accessToken = signAccessToken({
        userId: record.userId,
        clientId: record.clientId,
        resource: record.resource,
        issuer: baseUrl(),
        scope: record.scope,
        ttlSec: ACCESS_TOKEN_TTL_SEC,
      })
      // Rotate: issue a fresh refresh token, invalidating the consumed one.
      const rotated = await issueRefreshToken({
        clientId: record.clientId,
        userId: record.userId,
        scope: record.scope,
        resource: record.resource,
      })

      return c.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SEC,
        refresh_token: rotated,
        scope: record.scope,
      })
    }

    return tokenError(c, 'unsupported_grant_type', `Unsupported grant_type: ${grantType}`)
  })
}
