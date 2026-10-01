import { config } from '@/config'
import { decryptVantaSecret, encryptVantaSecret } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import {
  AUTH_URL,
  mintVantaClientCredentialsToken,
  tokenRequest,
  VantaApiError,
} from '@/lib/byos/vanta-core'
import { teamByosBindings } from '@/models'

import type { MintedToken } from '@/lib/byos/vanta-core'
import type { VantaIntegrationBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export {
  mintVantaClientCredentialsToken,
  VantaApiError,
  verifyVantaClientCredentials,
} from '@/lib/byos/vanta-core'
export { listVantaTests, VANTA_INFRA_CATEGORIES } from '@/lib/byos/vanta-tests'
export type { VantaTest } from '@/lib/byos/vanta-tests'

// Scope for the public-integration (connector) flow — scaffold.
const OAUTH_DEFAULT_SCOPE = config.byos.vanta.oauth.scopes

// ── Access-token cache + concurrency guard ─────────────────────────────────
// Vanta allows only ONE active access token per app — re-minting revokes the
// previous one. So we cache aggressively and mint only when the cached token is
// within 60s of expiry, and an in-flight map collapses concurrent mints (a
// double mint would revoke each other's token).

type CachedToken = { token: string; expiresAt: Date | null }
const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<string>>()

function cacheKey(teamId: ObjectId, bindingId: ObjectId): string {
  return `${teamId.toHexString()}:${bindingId.toHexString()}`
}

// A client_credentials binding re-mints from the stored client_id/secret; an
// oauth one can only do better than its stored token when it has a refresh
// token.
function canRefreshVantaToken(binding: VantaIntegrationBinding): boolean {
  if (binding.authType === 'client_credentials') return Boolean(binding.clientCredentials)

  return Boolean(binding.oauth?.encryptedRefreshToken)
}

export function invalidateVantaAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  accessTokenCache.delete(cacheKey(teamId, bindingId))
}

/**
 * Resolve a usable bearer token for a Vanta binding, regardless of authType.
 * - client_credentials: mint (and cache) a 1-hour token on demand.
 * - oauth: return the cached/persisted access token, refreshing it from the
 *   refresh token when it's within 60s of expiry (mirrors cloudflare-oauth.ts).
 */
export async function getVantaAccessToken(
  teamId: ObjectId,
  binding: VantaIntegrationBinding,
): Promise<string> {
  const key = cacheKey(teamId, binding.id)
  const canRefresh = canRefreshVantaToken(binding)
  const cached = accessTokenCache.get(key)

  if (cached && tokenStillFresh(cached.expiresAt, canRefresh)) return cached.token

  const inflight = accessTokenInflight.get(key)

  if (inflight) return inflight

  const resolving = (async () => {
    if (binding.authType === 'client_credentials') {
      const cc = binding.clientCredentials

      if (!cc) throw new VantaApiError(500, 'Vanta binding has no client credentials')
      const minted = await mintVantaClientCredentialsToken(
        cc.clientId,
        decryptVantaSecret(cc.encryptedClientSecret),
      )

      accessTokenCache.set(key, { token: minted.accessToken, expiresAt: minted.expiresAt })

      return minted.accessToken
    }

    return refreshVantaOAuthToken(teamId, binding, key)
  })().finally(() => accessTokenInflight.delete(key))

  accessTokenInflight.set(key, resolving)

  return resolving
}

// ── Public-integration OAuth (scaffold) ────────────────────────────────────
// Unused until VANTA_OAUTH_* is configured (Vanta partner approved).

export function getVantaOAuthClient(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.byos.vanta.oauth

  if (!clientId || !clientSecret) return null

  return { clientId, clientSecret }
}

export function getVantaOAuthSetupRedirect(): string | null {
  return config.byos.vanta.oauth.setupRedirect ?? null
}

export function isVantaOAuthConfigured(): boolean {
  return !!getVantaOAuthClient() && !!getVantaOAuthSetupRedirect()
}

export function buildVantaAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scope,
}: {
  clientId: string
  redirectUri: string
  state: string
  scope?: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scope ?? OAUTH_DEFAULT_SCOPE,
    state,
  })

  return `${AUTH_URL}?${params.toString()}`
}

export async function exchangeVantaCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<MintedToken> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  })
}

async function refreshVantaOAuthToken(
  teamId: ObjectId,
  binding: VantaIntegrationBinding,
  key: string,
): Promise<string> {
  const oauth = binding.oauth

  if (!oauth) throw new VantaApiError(500, 'Vanta binding is not an OAuth binding')

  const exp = oauth.accessTokenExpiresAt

  if (tokenStillFresh(exp, Boolean(oauth.encryptedRefreshToken))) {
    const token = decryptVantaSecret(oauth.encryptedAccessToken)

    accessTokenCache.set(key, { token, expiresAt: exp })

    return token
  }
  if (!oauth.encryptedRefreshToken) {
    // No refresh token — return the (possibly stale) access token; the API call
    // surfaces a 401 if it has truly expired.
    return decryptVantaSecret(oauth.encryptedAccessToken)
  }
  const client = getVantaOAuthClient()

  if (!client) throw new VantaApiError(503, 'Vanta OAuth client is not configured on the server')

  const fresh = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: decryptVantaSecret(oauth.encryptedRefreshToken),
    client_id: client.clientId,
    client_secret: client.clientSecret,
  })

  await teamByosBindings().updateOne(
    { _id: teamId, 'vantaIntegrations.id': binding.id },
    {
      $set: {
        'vantaIntegrations.$.oauth.encryptedAccessToken': encryptVantaSecret(fresh.accessToken),
        'vantaIntegrations.$.oauth.encryptedRefreshToken': fresh.refreshToken
          ? encryptVantaSecret(fresh.refreshToken)
          : oauth.encryptedRefreshToken,
        'vantaIntegrations.$.oauth.accessTokenExpiresAt': fresh.expiresAt,
        ...(fresh.scope ? { 'vantaIntegrations.$.oauth.scope': fresh.scope } : {}),
        updatedAt: new Date(),
      },
    },
  )
  accessTokenCache.set(key, { token: fresh.accessToken, expiresAt: fresh.expiresAt })

  return fresh.accessToken
}
