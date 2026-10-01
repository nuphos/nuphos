// Sentry is a single hosted OAuth 2.0 provider (sentry.io). Access tokens live
// ~30 days and the refresh token IS rotated on every refresh (unlike Asana), so
// the rotated token must be persisted or the binding dies at the next refresh.
// OAuth is account-wide, so a binding is the connected Sentry user; the agent
// selects an organization at query time via GET /organizations/.
const SENTRY_AUTHORIZE_URL = 'https://sentry.io/oauth/authorize/'
const SENTRY_TOKEN_URL = 'https://sentry.io/oauth/token/'
const USER_AGENT = 'nuphos-backend'
const SENTRY_FETCH_TIMEOUT_MS = 30_000

export class SentryApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class SentryOAuthNotConfigured extends Error {
  constructor() {
    super('Sentry OAuth is not configured (set SENTRY_OAUTH_CLIENT_ID/SECRET)')
  }
}

async function sentryFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(SENTRY_FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new SentryApiError(
        504,
        `Sentry request timed out after ${String(SENTRY_FETCH_TIMEOUT_MS)}ms`,
      )
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new SentryApiError(502, `Sentry request failed: ${message}`)
  }
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

  return `${SENTRY_AUTHORIZE_URL}?${params.toString()}`
}

// Sentry returns the authorising user in the token response's `user` field, so
// (unlike Jira's accessible-resources call) no extra request is needed to
// identify the account.
export type SentryAccount = {
  userId: string
  name: string | null
  email: string | null
}

type RawTokenResponse = {
  access_token: string
  token_type: string
  expires_in?: number
  // Sentry sends both expires_in (seconds) and expires_at (ISO). Read the
  // latter as a fallback: a null expiry makes getAccessToken cache the token
  // forever and never refresh, so the binding would silently 401 at ~30d with
  // no way to self-heal.
  expires_at?: string
  refresh_token?: string
  scope?: string
  user?: { id?: number | string; name?: string; email?: string }
}

function parseExpiry(raw: RawTokenResponse): Date | null {
  // Number check, not truthiness: expires_in === 0 means "already expired" and
  // must yield an expired Date so the next handout refreshes. Treating it as
  // falsy would fall through to null, i.e. cache forever — the very trap this
  // function exists to avoid.
  if (typeof raw.expires_in === 'number') return new Date(Date.now() + raw.expires_in * 1000)
  if (raw.expires_at) {
    const parsed = new Date(raw.expires_at)

    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return null
}

export type ExchangedTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string
  account: SentryAccount | null
}

// Exported for unit testing the token rotation + expiry math.
export function parseTokenResponse(
  raw: RawTokenResponse,
  fallbackRefreshToken?: string,
): ExchangedTokens {
  const rawUserId = raw.user?.id
  const account: SentryAccount | null =
    rawUserId == null
      ? null
      : { userId: String(rawUserId), name: raw.user?.name ?? null, email: raw.user?.email ?? null }

  return {
    accessToken: raw.access_token,
    // Sentry rotates the refresh token on every refresh, so a refresh response
    // carries a NEW refresh_token that must replace the stored one. The fallback
    // only guards a malformed response that omits it entirely.
    refreshToken: raw.refresh_token ?? fallbackRefreshToken ?? null,
    expiresAt: parseExpiry(raw),
    scope: raw.scope ?? '',
    account,
  }
}

async function postToken(body: Record<string, string>): Promise<RawTokenResponse> {
  const res = await sentryFetch(SENTRY_TOKEN_URL, {
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

    throw new SentryApiError(res.status, `Sentry oauth/token failed: ${String(res.status)} ${text}`)
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
