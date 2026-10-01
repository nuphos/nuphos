import { config } from '@/config'
import { decryptAsanaSecret } from '@/lib/byos/secrets'

import type { AsanaAccountBinding } from '@/models'

// Asana is a single hosted OAuth 2.0 provider (app.asana.com). Access tokens
// are short-lived (~1h); the refresh token is long-lived and — unlike Atlassian
// — does NOT rotate on use. Bindings store an encrypted refresh token + expiry
// and the credential handout refreshes ~60s ahead of expiry (mirrors GitLab).
// OAuth is account-wide, so a binding is the connected Asana account; the agent
// selects a workspace at query time. All REST calls go to ASANA_API_BASE_URL.
const ASANA_AUTHORIZE_URL = 'https://app.asana.com/-/oauth_authorize'
const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token'
const ASANA_REVOKE_URL = 'https://app.asana.com/-/oauth_revoke'

export const ASANA_API_BASE_URL = 'https://app.asana.com/api/1.0'
const USER_AGENT = 'nuphos-backend'
const ASANA_FETCH_TIMEOUT_MS = 30_000

export class AsanaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class AsanaOAuthNotConfigured extends Error {
  constructor() {
    super('Asana OAuth is not configured (set ASANA_OAUTH_CLIENT_ID/SECRET)')
  }
}

async function asanaFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(ASANA_FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AsanaApiError(
        504,
        `Asana request timed out after ${String(ASANA_FETCH_TIMEOUT_MS)}ms`,
      )
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new AsanaApiError(502, `Asana request failed: ${message}`)
  }
}

export function getDefaultClientCredentials(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.byos.asana

  if (!clientId || !clientSecret) return null

  return { clientId, clientSecret }
}

export function getSetupRedirect(): string | null {
  return config.byos.asana.setupRedirect ?? null
}

export function isAsanaConfigured(): boolean {
  // Without the encryption key, /asana-app/setup throws mid-handler in
  // encryptAsanaSecret and the desktop install promise waits out its full
  // timeout instead of redirecting back into the app.
  return Boolean(
    config.byos.asana.clientId &&
    config.byos.asana.clientSecret &&
    config.byos.asana.setupRedirect &&
    config.byos.asana.encryptionKey,
  )
}

// ── OAuth: authorize URL + code exchange + refresh ──

export type AuthorizeUrlInput = {
  clientId: string
  redirectUri: string
  state: string
  scope: string
}

export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scope,
}: AuthorizeUrlInput): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope,
  })

  return `${ASANA_AUTHORIZE_URL}?${params.toString()}`
}

// Asana returns the authorising user in the token response's `data` field, so
// (unlike Jira's accessible-resources call) no extra request is needed to
// identify the account.
export type AsanaAccount = {
  gid: string
  name: string | null
  email: string | null
}

type RawTokenResponse = {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  data?: { gid?: string; id?: number | string; name?: string; email?: string }
}

export type ExchangedTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string
  account: AsanaAccount | null
}

// Exported for unit testing the refresh-token-not-rotated fallback + expiry math.
export function parseTokenResponse(
  raw: RawTokenResponse,
  fallbackRefreshToken?: string,
): ExchangedTokens {
  const account: AsanaAccount | null = raw.data?.gid
    ? { gid: raw.data.gid, name: raw.data.name ?? null, email: raw.data.email ?? null }
    : null

  return {
    accessToken: raw.access_token,
    // Asana refresh tokens are long-lived and not rotated, so a refresh
    // response omits refresh_token — keep the one we already hold.
    refreshToken: raw.refresh_token ?? fallbackRefreshToken ?? null,
    expiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : null,
    scope: raw.scope ?? '',
    account,
  }
}

async function postToken(body: Record<string, string>): Promise<RawTokenResponse> {
  const res = await asanaFetch(ASANA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new AsanaApiError(res.status, `Asana oauth_token failed: ${String(res.status)} ${text}`)
  }

  return (await res.json()) as RawTokenResponse
}

export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const raw = await postToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  })

  return parseTokenResponse(raw)
}

export async function refreshTokens(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<ExchangedTokens> {
  const raw = await postToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  })

  return parseTokenResponse(raw, refreshToken)
}

// Best-effort revocation of the grant at Asana on unbind. Asana's revoke
// endpoint takes the (long-lived, non-rotating) refresh token; revoking it also
// invalidates every derived access token. Never throws — unbind must still
// remove the local binding even if Asana is unreachable. Returns whether the
// grant was revoked so callers can log a best-effort miss.
export async function revokeGrant(binding: AsanaAccountBinding): Promise<boolean> {
  if (!binding.encryptedRefreshToken) return false
  const credentials = getDefaultClientCredentials()

  if (!credentials) return false
  try {
    const refreshToken = decryptAsanaSecret(binding.encryptedRefreshToken)
    const res = await asanaFetch(ASANA_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        token: refreshToken,
      }).toString(),
    })

    return res.ok
  } catch {
    return false
  }
}
