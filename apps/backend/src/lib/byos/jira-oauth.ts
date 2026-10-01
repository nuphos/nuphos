import { config } from '@/config'

// Atlassian (Jira Cloud) is a single hosted OAuth provider. Access tokens are
// short-lived (~1h) and rotate refresh tokens on every exchange, so bindings
// store an encrypted refresh token + expiry and the credential handout
// refreshes ~60s ahead of expiry (mirrors GitLab).
const ATLASSIAN_AUTHORIZE_URL = 'https://auth.atlassian.com/authorize'
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const ATLASSIAN_ACCESSIBLE_RESOURCES_URL =
  'https://api.atlassian.com/oauth/token/accessible-resources'
// audience is required by Atlassian 3LO so the token works against the Jira REST API.
const ATLASSIAN_AUDIENCE = 'api.atlassian.com'
const USER_AGENT = 'nuphos-backend'
const JIRA_FETCH_TIMEOUT_MS = 30_000

export class JiraApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class JiraOAuthNotConfigured extends Error {
  constructor() {
    super('Jira OAuth is not configured (set JIRA_OAUTH_CLIENT_ID/SECRET)')
  }
}

async function jiraFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(JIRA_FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new JiraApiError(504, `Jira request timed out after ${String(JIRA_FETCH_TIMEOUT_MS)}ms`)
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new JiraApiError(502, `Jira request failed: ${message}`)
  }
}

export function getDefaultClientCredentials(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.byos.jira

  if (!clientId || !clientSecret) return null

  return { clientId, clientSecret }
}

export function getSetupRedirect(): string | null {
  return config.byos.jira.setupRedirect ?? null
}

export function isJiraConfigured(): boolean {
  // Without the encryption key, /jira-app/setup throws mid-handler in
  // encryptJiraSecret and the desktop install promise waits out its full
  // timeout instead of redirecting back into the app.
  return Boolean(
    config.byos.jira.clientId &&
    config.byos.jira.clientSecret &&
    config.byos.jira.setupRedirect &&
    config.byos.jira.encryptionKey,
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
    audience: ATLASSIAN_AUDIENCE,
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    // Force the consent screen so a refresh token is always issued, even on
    // re-authorisation of an already-granted app.
    prompt: 'consent',
  })

  return `${ATLASSIAN_AUTHORIZE_URL}?${params.toString()}`
}

type RawTokenResponse = {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export type ExchangedTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string
}

export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const res = await jiraFetch(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new JiraApiError(
      res.status,
      `Atlassian oauth/token failed: ${String(res.status)} ${text}`,
    )
  }
  const raw = (await res.json()) as RawTokenResponse

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : null,
    scope: raw.scope ?? '',
  }
}

export async function refreshTokens(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<ExchangedTokens> {
  const res = await jiraFetch(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new JiraApiError(
      res.status,
      `Atlassian oauth/token (refresh) failed: ${String(res.status)} ${text}`,
    )
  }
  const raw = (await res.json()) as RawTokenResponse

  return {
    // Atlassian rotates the refresh token on every use; persist the new one or
    // the next refresh fails with invalid_grant.
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? refreshToken,
    expiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : null,
    scope: raw.scope ?? '',
  }
}

// ── Accessible resources (cloudId discovery) ──

export type AtlassianSite = {
  id: string
  name: string
  url: string
  scopes: string[]
}

// Lists the Atlassian sites (cloudId + url) the grant can reach. The bind route
// picks one as the binding's site; the agent calls
// api.atlassian.com/ex/jira/<cloudId>/rest/api/3/… with the access token.
export async function getAccessibleResources(accessToken: string): Promise<AtlassianSite[]> {
  const res = await jiraFetch(ATLASSIAN_ACCESSIBLE_RESOURCES_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')

    throw new JiraApiError(
      res.status,
      `Atlassian accessible-resources failed: ${String(res.status)} ${text}`,
    )
  }
  const raw = (await res.json().catch(() => null)) as
    | {
        id?: string
        name?: string
        url?: string
        scopes?: string[]
      }[]
    | null

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new JiraApiError(502, 'Atlassian grant has no accessible Jira sites')
  }

  return raw
    .filter((r): r is { id: string; url: string } & typeof r => Boolean(r.id && r.url))
    .map((r) => ({
      id: r.id as string,
      name: r.name ?? (r.url as string),
      url: r.url as string,
      scopes: r.scopes ?? [],
    }))
}
