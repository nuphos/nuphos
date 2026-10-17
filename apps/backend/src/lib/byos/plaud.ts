import { publicBackendUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import { decryptPlaudSecret, encryptPlaudSecret } from '@/lib/byos/secrets'
import { tokenStillFresh } from '@/lib/byos/token-freshness'
import { teamByosBindings } from '@/models'

import type { PlaudAccountBinding } from '@/models'
import type { ObjectId } from 'mongodb'

// Plaud's hosted MCP server is also its public OAuth 2.1 authorization server:
// it accepts dynamic client registration and PKCE public clients, and its token
// endpoint hands back the user's Plaud developer-platform token. So a connect
// registers a client for our callback, and no Plaud client id/secret is
// configured anywhere. The token works against both the MCP server and the
// REST API the agent calls.
const PLAUD_OAUTH_BASE = 'https://mcp.plaud.ai'

export const PLAUD_API_BASE_URL = 'https://platform.plaud.ai/developer/api'
export const PLAUD_MCP_URL = 'https://mcp.plaud.ai/mcp'
export const PLAUD_CALLBACK_PATH = '/plaud-app/callback'
const PLAUD_FETCH_TIMEOUT_MS = 30_000

// Messages carry only the path and status: upstream bodies may echo tokens or
// codes, and these messages reach the desktop deep link and API errors.
export class PlaudApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function plaudFetchJson<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response

  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(PLAUD_FETCH_TIMEOUT_MS) })
  } catch {
    throw new PlaudApiError(502, `Plaud ${new URL(url).pathname} is unreachable`)
  }
  if (!res.ok) {
    throw new PlaudApiError(
      res.status,
      `Plaud ${new URL(url).pathname} failed (HTTP ${String(res.status)})`,
    )
  }

  return (await res.json()) as T
}

/** The HTTPS callback, or null: Plaud only redirects to a public URL. */
export function plaudRedirectUri(): string | null {
  const base = publicBackendUrl()

  return base?.startsWith('https://') ? `${base}${PLAUD_CALLBACK_PATH}` : null
}

export async function registerPlaudClient(redirectUri: string): Promise<string> {
  const body = await plaudFetchJson<{ client_id?: string }>(`${PLAUD_OAUTH_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Nuphos',
      client_uri: 'https://nuphos.ai',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })

  if (!body.client_id)
    throw new PlaudApiError(502, 'Plaud client registration returned no client_id')

  return body.client_id
}

export function buildPlaudAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  })

  return `${PLAUD_OAUTH_BASE}/authorize?${params.toString()}`
}

export type PlaudTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number }

async function tokenRequest(form: Record<string, string>, fallbackRefresh?: string) {
  const body = await plaudFetchJson<TokenResponse>(`${PLAUD_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  })

  if (!body.access_token)
    throw new PlaudApiError(502, 'Plaud token response carried no access_token')

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? fallbackRefresh ?? null,
    expiresAt:
      typeof body.expires_in === 'number' ? new Date(Date.now() + body.expires_in * 1000) : null,
  }
}

export async function exchangePlaudCode(input: {
  clientId: string
  redirectUri: string
  code: string
  codeVerifier: string
}): Promise<PlaudTokens> {
  return await tokenRequest({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  })
}

export type PlaudUser = { id: string; name: string | null; email: string | null }

export async function fetchPlaudUser(accessToken: string): Promise<PlaudUser> {
  const raw = await plaudFetchJson<Record<string, unknown>>(
    `${PLAUD_API_BASE_URL}/open/third-party/users/current`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  )
  const user = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<
    string,
    unknown
  >
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const id = str(user.id)

  if (!id) throw new PlaudApiError(502, 'Plaud did not return the authorising user')

  return { id, name: str(user.nickname) ?? str(user.name), email: str(user.email) }
}

// Best-effort: unbind must still succeed when Plaud is unreachable.
export async function revokePlaudGrant(teamId: ObjectId, binding: PlaudAccountBinding) {
  try {
    const token = await getPlaudAccessToken(teamId, binding)

    await fetch(`${PLAUD_API_BASE_URL}/open/third-party/users/current/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.token}` },
      signal: AbortSignal.timeout(PLAUD_FETCH_TIMEOUT_MS),
    })
  } catch {
    // The local binding is already gone.
  }
}

// ── Access-token handout with on-demand refresh ──

type CachedToken = { token: string; expiresAt: Date | null }

const cacheKey = (teamId: ObjectId, bindingId: ObjectId) =>
  `${teamId.toHexString()}:${bindingId.toHexString()}`
const accessTokenCache = new Map<string, CachedToken>()
const accessTokenInflight = new Map<string, Promise<CachedToken>>()

export function invalidatePlaudAccessToken(teamId: ObjectId, bindingId: ObjectId): void {
  accessTokenCache.delete(cacheKey(teamId, bindingId))
  accessTokenInflight.delete(cacheKey(teamId, bindingId))
}

export async function getPlaudAccessToken(
  teamId: ObjectId,
  binding: PlaudAccountBinding,
): Promise<CachedToken> {
  const key = cacheKey(teamId, binding.id)
  const canRefresh = Boolean(binding.encryptedRefreshToken)
  const cached = accessTokenCache.get(key)

  if (cached && tokenStillFresh(cached.expiresAt, canRefresh)) return cached
  if (!binding.encryptedRefreshToken || tokenStillFresh(binding.accessTokenExpiresAt, true)) {
    return {
      token: decryptPlaudSecret(binding.encryptedAccessToken),
      expiresAt: binding.accessTokenExpiresAt,
    }
  }

  const inflight = accessTokenInflight.get(key)

  if (inflight) return await inflight
  const encryptedRefreshToken = binding.encryptedRefreshToken
  const refreshing = (async (): Promise<CachedToken> => {
    const refreshToken = decryptPlaudSecret(encryptedRefreshToken)
    const fresh = await tokenRequest(
      { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: binding.clientId },
      refreshToken,
    )
    // Only write back over the expiry this refresh started from, so a
    // reconnect that landed meanwhile is not clobbered.
    const write = await teamByosBindings().updateOne(
      {
        _id: teamId,
        plaudAccounts: {
          $elemMatch: { id: binding.id, accessTokenExpiresAt: binding.accessTokenExpiresAt },
        },
      },
      {
        $set: {
          'plaudAccounts.$.encryptedAccessToken': encryptPlaudSecret(fresh.accessToken),
          'plaudAccounts.$.encryptedRefreshToken': fresh.refreshToken
            ? encryptPlaudSecret(fresh.refreshToken)
            : encryptedRefreshToken,
          'plaudAccounts.$.accessTokenExpiresAt': fresh.expiresAt,
          updatedAt: new Date(),
        },
      },
    )
    const out = { token: fresh.accessToken, expiresAt: fresh.expiresAt }

    if (write.matchedCount > 0) accessTokenCache.set(key, out)

    return out
  })().finally(() => {
    if (accessTokenInflight.get(key) === refreshing) accessTokenInflight.delete(key)
  })

  accessTokenInflight.set(key, refreshing)

  return await refreshing
}
