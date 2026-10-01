// Vanta API endpoints (confirmed live via developer.vanta.com).
export const API_BASE = 'https://api.vanta.com'
const TOKEN_URL = `${API_BASE}/oauth/token`

// Authorize endpoint for the public-integration (authorization_code) flow.
export const AUTH_URL = 'https://app.vanta.com/oauth/authorize'
// Read scope for the client_credentials (Manage Vanta) flow.
const READ_SCOPE = 'vanta-api.all:read'

export const FETCH_TIMEOUT_MS = 15_000

export class VantaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'VantaApiError'
  }
}

// ── Token minting ──────────────────────────────────────────────────────────

type RawTokenResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export type MintedToken = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string
}

export async function tokenRequest(body: Record<string, string>): Promise<MintedToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const raw = (await res.json().catch(() => ({}))) as RawTokenResponse

  if (!res.ok || raw.error || !raw.access_token) {
    const detail = raw.error_description || raw.error || `HTTP ${String(res.status)}`

    throw new VantaApiError(res.status, `Vanta token request failed: ${detail}`)
  }
  // Vanta access tokens last 1 hour. Fall back to that documented TTL when the
  // response omits expires_in — otherwise a null expiry is treated as
  // "never expires" by the cache and a stale bearer could be served until the
  // process restarts.
  const expiresInSeconds = raw.expires_in ?? 60 * 60

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    scope: raw.scope ?? '',
  }
}

/** Mint a read token from a Manage-Vanta app's client_id/secret. */
export async function mintVantaClientCredentialsToken(
  clientId: string,
  clientSecret: string,
): Promise<MintedToken> {
  return tokenRequest({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: READ_SCOPE,
  })
}

/**
 * Verify a pasted client_id/secret by minting a token. Surfaces a 400 for bad
 * credentials so the bind route can give a clean error.
 */
export async function verifyVantaClientCredentials(
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await mintVantaClientCredentialsToken(clientId, clientSecret)
}
