import { timingSafeEqual } from 'node:crypto'

import { config } from '@/config'

import {
  GitlabApiError,
  GitlabOAuthNotConfigured,
  USER_AGENT,
  gitlabFetch,
  normalizeHostUrl,
} from './http'

export function getDefaultClientCredentials(): { clientId: string; clientSecret: string } | null {
  const { clientId, clientSecret } = config.byos.gitlab

  if (!clientId || !clientSecret) return null

  return { clientId, clientSecret }
}

export function getSetupRedirect(): string | null {
  return config.byos.gitlab.setupRedirect ?? null
}

export function isGitlabConfigured(): boolean {
  // Both must be set: without the encryption key, /gitlab-app/setup throws
  // mid-handler in encryptGitlabSecret, returns 500 to the browser, and the
  // Electron startInstall promise silently waits out its full 10-minute
  // timeout instead of redirecting back into the app.
  return Boolean(config.byos.gitlab.setupRedirect && config.byos.gitlab.encryptionKey)
}

export type OAuthClientResolution = {
  clientId: string
  clientSecret: string
  // True when the credentials came from the server config (gitlab.com default)
  // rather than per-binding overrides. We don't store the secret on the
  // binding in that case — operators can rotate the env var without
  // invalidating every binding.
  isDefault: boolean
}

export function resolveOAuthClient(
  hostUrl: string,
  override?: { clientId?: string; clientSecret?: string } | null,
): OAuthClientResolution {
  const normalized = normalizeHostUrl(hostUrl)

  if (override?.clientId && override?.clientSecret) {
    return { clientId: override.clientId, clientSecret: override.clientSecret, isDefault: false }
  }
  if (normalized === 'https://gitlab.com') {
    const defaults = getDefaultClientCredentials()

    if (defaults) {
      return { ...defaults, isDefault: true }
    }
  }
  throw new GitlabOAuthNotConfigured()
}

// ── OAuth: authorize URL + code exchange + refresh ──

export type AuthorizeUrlInput = {
  hostUrl: string
  clientId: string
  redirectUri: string
  state: string
  scope: string
}

export function buildAuthorizeUrl({
  hostUrl,
  clientId,
  redirectUri,
  state,
  scope,
}: AuthorizeUrlInput): string {
  const host = normalizeHostUrl(hostUrl)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
  })

  return `${host}/oauth/authorize?${params.toString()}`
}

type RawTokenResponse = {
  access_token: string
  token_type: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  created_at?: number
}

export type ExchangedTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string
}

export async function exchangeCodeForTokens(
  hostUrl: string,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const host = normalizeHostUrl(hostUrl)
  const res = await gitlabFetch(`${host}/oauth/token`, {
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

    throw new GitlabApiError(
      res.status,
      `GitLab oauth/token (code) failed: ${String(res.status)} ${text}`,
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
  hostUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<ExchangedTokens> {
  const host = normalizeHostUrl(hostUrl)
  const res = await gitlabFetch(`${host}/oauth/token`, {
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

    throw new GitlabApiError(
      res.status,
      `GitLab oauth/token (refresh) failed: ${String(res.status)} ${text}`,
    )
  }
  const raw = (await res.json()) as RawTokenResponse

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? refreshToken,
    expiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : null,
    scope: raw.scope ?? '',
  }
}

// ── Webhook signature ──
//
// GitLab webhooks use a shared-secret token passed in X-Gitlab-Token rather
// than an HMAC. We compare the secret using timingSafeEqual to avoid timing
// leaks on misconfigured deployments.
export function verifyWebhookToken(headerToken: string | null | undefined): boolean {
  const secret = config.byos.gitlab.webhookSecret

  if (!secret) return false
  if (!headerToken) return false
  const a = Buffer.from(headerToken)
  const b = Buffer.from(secret)

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
