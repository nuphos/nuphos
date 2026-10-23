// GitHub App user-to-server OAuth: the existing App's OAuth client acting as
// a member. The resulting token can do only what both the member and the App
// installation allow.
import { config } from '@/config'
import { GITHUB_API, GithubApiError, githubFetch, USER_AGENT } from '@/lib/byos/github-http'

export type ProviderTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'

export function githubOAuthClient(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.byos.github

  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export function githubAuthorizeUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
  })

  return `${AUTHORIZE_URL}?${params.toString()}`
}

type RawToken = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: string
  error_description?: string
}

// GitHub answers OAuth errors with HTTP 200 and an `error` field.
async function tokenRequest(body: Record<string, string>): Promise<ProviderTokens> {
  const res = await githubFetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  })
  const raw = (await res.json().catch(() => ({}))) as RawToken

  if (!res.ok || !raw.access_token) {
    throw new GithubApiError(
      res.ok ? 400 : res.status,
      `GitHub oauth/access_token failed: ${raw.error_description ?? raw.error ?? String(res.status)}`,
    )
  }

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : null,
  }
}

export function exchangeGithubCode(args: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
  codeVerifier: string
}): Promise<ProviderTokens> {
  return tokenRequest({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  })
}

export function refreshGithubToken(refreshToken: string): Promise<ProviderTokens> {
  const client = githubOAuthClient()

  if (!client) throw new GithubApiError(503, 'GitHub App OAuth client is not configured')

  return tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

async function userRequest<T>(token: string, path: string): Promise<T> {
  const res = await githubFetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
    },
  })

  if (!res.ok) throw new GithubApiError(res.status, `GitHub ${path} failed: ${String(res.status)}`)

  return (await res.json()) as T
}

export async function getGithubUser(token: string): Promise<{ id: string; login: string }> {
  const user = await userRequest<{ id: number; login: string }>(token, '/user')

  return { id: String(user.id), login: user.login }
}

/** Installations of this App that the member can access. */
export async function githubUserInstallationIds(token: string): Promise<number[]> {
  const ids: number[] = []

  for (let page = 1; ; page++) {
    const data = await userRequest<{ installations: { id: number }[] }>(
      token,
      `/user/installations?per_page=100&page=${String(page)}`,
    )

    ids.push(...data.installations.map((installation) => installation.id))
    if (data.installations.length < 100) return ids
  }
}

/** Best-effort: deletes this one token at GitHub. */
export async function revokeGithubToken(token: string): Promise<void> {
  const client = githubOAuthClient()

  if (!client) return
  const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')

  await githubFetch(`${GITHUB_API}/applications/${encodeURIComponent(client.clientId)}/token`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ access_token: token }),
  })
}
