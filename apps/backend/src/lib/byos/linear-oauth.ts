import {
  LINEAR_AUTHORIZE_URL,
  LINEAR_TOKEN_URL,
  LinearApiError,
  linearFetch,
  USER_AGENT,
} from '@/lib/byos/linear-http'

// ── OAuth: authorize URL + code exchange ──

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
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
    // actor=app makes issues/comments authored by the Nuphos OAuth app rather
    // than impersonating the authorising user.
    actor: 'app',
  })

  return `${LINEAR_AUTHORIZE_URL}?${params.toString()}`
}

type RawTokenResponse = {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string | string[]
}

export type ExchangedTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string
}

export function parseTokenResponse(
  raw: RawTokenResponse,
  fallbackRefreshToken: string | null = null,
): ExchangedTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? fallbackRefreshToken,
    expiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : null,
    scope: Array.isArray(raw.scope) ? raw.scope.join(',') : (raw.scope ?? ''),
  }
}

export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const res = await linearFetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new LinearApiError(res.status, `Linear oauth/token failed: ${String(res.status)} ${text}`)
  }

  return parseTokenResponse((await res.json()) as RawTokenResponse)
}

export async function refreshTokens(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<ExchangedTokens> {
  const res = await linearFetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new LinearApiError(
      res.status,
      `Linear oauth/token (refresh) failed: ${String(res.status)} ${text}`,
    )
  }

  // Linear rotates the refresh token on every use (with a 30-minute grace
  // period on the old one); persist whatever comes back.
  return parseTokenResponse((await res.json()) as RawTokenResponse, refreshToken)
}
