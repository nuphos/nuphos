import { config } from '@/config'
import { decryptCloudflareApiKey, encryptCloudflareApiKey } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { teamByosBindings } from '@/models'

import type { CloudflareAccountBinding } from '@/models'
import type { ObjectId } from 'mongodb'

// Cloudflare self-managed OAuth endpoints (confirmed live).
// https://developers.cloudflare.com/fundamentals/oauth/
const AUTH_URL = 'https://dash.cloudflare.com/oauth2/auth'
const TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token'
// Deadline for the OAuth token-exchange and account-discovery fetches so a hung
// upstream can't stall the callback handler indefinitely (matches identity.ts).
const OAUTH_FETCH_TIMEOUT_MS = 10_000

// Scopes requested at authorize time (see config.byos.cloudflare.oauth.scopes).
// The desktop normally sends an explicit subset; this is the fallback.
const DEFAULT_SCOPES = config.byos.cloudflare.oauth.scopes

export class CloudflareOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudflareOAuthError'
  }
}

export function getCloudflareOAuthClient(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.byos.cloudflare.oauth

  if (!clientId || !clientSecret) return null

  return { clientId, clientSecret }
}

export function getCloudflareOAuthSetupRedirect(): string | null {
  return config.byos.cloudflare.oauth.setupRedirect ?? null
}

export function isCloudflareOAuthConfigured(): boolean {
  return !!getCloudflareOAuthClient() && !!getCloudflareOAuthSetupRedirect()
}

export function getCloudflareOAuthScopes(): string {
  return DEFAULT_SCOPES
}

/**
 * Build the `scope` query value from a caller-selected list, falling back to the
 * server default. `offline_access` is always included so we get a refresh token.
 */
export function resolveCloudflareScopeParam(selected?: string[]): string {
  const base = selected && selected.length > 0 ? selected : DEFAULT_SCOPES.split(/\s+/)
  const set = new Set(base.map((s) => s.trim()).filter(Boolean))

  set.add('offline_access')

  return Array.from(set).join(' ')
}

export function buildCloudflareAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scope,
}: {
  clientId: string
  redirectUri: string
  state: string
  scope: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
  })

  return `${AUTH_URL}?${params.toString()}`
}

export type CloudflareOAuthTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string
}

type RawTokenResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function tokenRequest(body: Record<string, string>): Promise<CloudflareOAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
  })
  const raw = (await res.json().catch(() => ({}))) as RawTokenResponse

  if (!res.ok || raw.error || !raw.access_token) {
    const detail = raw.error_description || raw.error || `HTTP ${String(res.status)}`

    throw new CloudflareOAuthError(`Cloudflare token request failed: ${detail}`)
  }

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : null,
    scope: raw.scope ?? '',
  }
}

export async function exchangeCloudflareCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<CloudflareOAuthTokens> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  })
}

async function refreshCloudflareTokens(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<CloudflareOAuthTokens> {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })
}

/** Identify which Cloudflare account an access token was granted for. */
export async function discoverCloudflareAccount(
  accessToken: string,
): Promise<{ accountId: string; accountName: string | null }> {
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=50', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS),
  })
  const payload = (await res.json().catch(() => ({}))) as {
    success?: boolean
    result?: { id: string; name?: string }[]
    errors?: { message?: string }[]
  }

  if (!res.ok || payload.success === false) {
    const msg = payload.errors?.find((e) => e.message)?.message ?? `HTTP ${String(res.status)}`

    throw new CloudflareOAuthError(`Could not read accounts for OAuth token: ${msg}`)
  }
  const account = payload.result?.[0]

  if (!account) {
    throw new CloudflareOAuthError(
      'OAuth token did not grant access to any Cloudflare account. Re-authorize and pick an account.',
    )
  }

  return { accountId: account.id, accountName: account.name ?? null }
}

// ── Access-token cache + auto-refresh (mirrors gitlab.ts) ──

type CachedToken = { token: string; expiresAt: Date | null }
const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<string>>()

function cacheKey(teamId: ObjectId, bindingId: ObjectId): string {
  return `${teamId.toHexString()}:${bindingId.toHexString()}`
}

export function invalidateCloudflareAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  const key = cacheKey(teamId, bindingId)

  accessTokenCache.delete(key)
  // Drop the inflight entry too: a refresh started before the re-bind is still
  // running against the OLD refresh token, and leaving it in the map would hand
  // its superseded result to every caller awaiting that slot.
  accessTokenInflight.delete(key)
}

/**
 * Resolve a usable bearer token for an OAuth-backed Cloudflare binding,
 * refreshing it (and persisting the new tokens) when it's within 60s of expiry.
 */
export async function getCloudflareOAuthAccessToken(
  teamId: ObjectId,
  binding: CloudflareAccountBinding,
): Promise<string> {
  if (!binding.oauth) {
    throw new CloudflareOAuthError('Binding is not an OAuth binding')
  }
  const key = cacheKey(teamId, binding.id)
  const canRefresh = Boolean(binding.oauth.encryptedRefreshToken)

  const cached = accessTokenCache.get(key)

  if (cached && tokenStillFresh(cached.expiresAt, canRefresh)) return cached.token

  const exp = binding.oauth.accessTokenExpiresAt

  if (tokenStillFresh(exp, canRefresh)) {
    const token = decryptCloudflareApiKey(binding.oauth.encryptedAccessToken)

    accessTokenCache.set(key, { token, expiresAt: exp })

    return token
  }

  const inflight = accessTokenInflight.get(key)

  if (inflight) return inflight

  const refreshing = (async () => {
    const oauth = binding.oauth!

    if (!oauth.encryptedRefreshToken) {
      // No refresh token — return the (possibly stale) access token and let the
      // API call surface a 401 if it has truly expired.
      return decryptCloudflareApiKey(oauth.encryptedAccessToken)
    }
    const client = getCloudflareOAuthClient()

    if (!client) {
      throw new CloudflareOAuthError('Cloudflare OAuth client is not configured on the server')
    }
    const fresh = await refreshCloudflareTokens(
      client.clientId,
      client.clientSecret,
      decryptCloudflareApiKey(oauth.encryptedRefreshToken),
    )

    await teamByosBindings().updateOne(
      { _id: teamId, 'cloudflareAccounts.id': binding.id },
      {
        $set: {
          'cloudflareAccounts.$.oauth.encryptedAccessToken': encryptCloudflareApiKey(
            fresh.accessToken,
          ),
          'cloudflareAccounts.$.oauth.encryptedRefreshToken': fresh.refreshToken
            ? encryptCloudflareApiKey(fresh.refreshToken)
            : oauth.encryptedRefreshToken,
          'cloudflareAccounts.$.oauth.accessTokenExpiresAt': fresh.expiresAt,
          ...(fresh.scope ? { 'cloudflareAccounts.$.oauth.scope': fresh.scope } : {}),
          updatedAt: new Date(),
        },
      },
    )
    accessTokenCache.set(key, { token: fresh.accessToken, expiresAt: fresh.expiresAt })

    return fresh.accessToken
  })().finally(() => {
    // Only retract our own entry — a re-bind can clear the map mid-flight and
    // let a newer refresh take the slot (see linear.ts for the full rationale).
    if (accessTokenInflight.get(key) === refreshing) accessTokenInflight.delete(key)
  })

  accessTokenInflight.set(key, refreshing)

  return refreshing
}
