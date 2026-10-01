import { createHash, randomBytes } from 'node:crypto'

import { publicBackendUrl } from '@/lib/claude-code-preview/runtime-backend-url'

import { POSTHOG_REGION_HOSTS, posthogFetchJson } from './posthog-request'
import { encodeScopeSet } from './posthog-scopes'

import type { PosthogFetch } from './posthog-request'
import type { PosthogRegion } from '@/models'

export const POSTHOG_CALLBACK_PATH = '/posthog-app/callback'

export type PosthogOAuthClient = { clientId: string; redirectUri: string }

/**
 * PostHog treats a CIMD document's `com.posthog.scopes` as the app's required
 * scopes: all of them are shown locked on the consent screen and granted. Each
 * permission set therefore gets its own client, whose document declares exactly
 * that set and whose URL encodes it, so any id we ever issued stays servable.
 */
export function posthogMetadataPath(scopes: readonly string[]): string {
  return `/posthog-app/client-metadata/s/${encodeScopeSet(scopes)}.json`
}

/** The public base, or null: PostHog fetches the metadata document over HTTPS. */
export function posthogPublicBase(): string | null {
  const base = publicBackendUrl()

  return base?.startsWith('https://') ? base : null
}

export function posthogOAuthClient(scopes: readonly string[]): PosthogOAuthClient | null {
  const base = posthogPublicBase()

  if (!base) return null

  return {
    clientId: `${base}${posthogMetadataPath(scopes)}`,
    redirectUri: `${base}${POSTHOG_CALLBACK_PATH}`,
  }
}

export function posthogClientMetadata(client: PosthogOAuthClient, scopes: readonly string[]) {
  return {
    client_id: client.clientId,
    client_name: 'Nuphos',
    client_uri: 'https://nuphos.ai',
    logo_uri: 'https://nuphos.ai/favicon.svg',
    redirect_uris: [client.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    'com.posthog': { scopes: [...scopes] },
  }
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')

  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function buildPosthogAuthorizeUrl(input: {
  region: PosthogRegion
  client: PosthogOAuthClient
  state: string
  codeChallenge: string
  scopes: readonly string[]
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.client.clientId,
    redirect_uri: input.client.redirectUri,
    scope: input.scopes.join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  })

  return `${POSTHOG_REGION_HOSTS[input.region]}/oauth/authorize/?${params.toString()}`
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  scoped_teams?: number[] | null
  scoped_organizations?: string[] | null
  posthog_region?: string
  posthog_base_url?: string
}

export type PosthogTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string
  scopedTeams: number[]
  scopedOrganizations: string[]
}

function parseTokens(body: TokenResponse): PosthogTokens {
  if (!body.access_token) throw new Error('PostHog token response carried no access_token')

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt:
      typeof body.expires_in === 'number' ? new Date(Date.now() + body.expires_in * 1000) : null,
    scope: body.scope ?? '',
    scopedTeams: body.scoped_teams ?? [],
    scopedOrganizations: body.scoped_organizations ?? [],
  }
}

async function tokenRequest(
  apiBaseUrl: string,
  form: Record<string, string>,
  fetchImpl?: PosthogFetch,
): Promise<PosthogTokens> {
  const body = await posthogFetchJson<TokenResponse>(
    `${apiBaseUrl}/oauth/token/`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    },
    fetchImpl,
  )

  return parseTokens(body)
}

export async function exchangePosthogCode(
  input: {
    region: PosthogRegion
    client: PosthogOAuthClient
    code: string
    codeVerifier: string
  },
  fetchImpl?: PosthogFetch,
): Promise<PosthogTokens> {
  return await tokenRequest(
    POSTHOG_REGION_HOSTS[input.region],
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.client.redirectUri,
      client_id: input.client.clientId,
      code_verifier: input.codeVerifier,
    },
    fetchImpl,
  )
}

export async function refreshPosthogTokens(
  input: { apiBaseUrl: string; clientId: string; refreshToken: string },
  fetchImpl?: PosthogFetch,
): Promise<PosthogTokens> {
  return await tokenRequest(
    input.apiBaseUrl,
    {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
    },
    fetchImpl,
  )
}

/** RFC 7009 revocation; PostHog sweeps the grant's access tokens with its refresh token. */
export async function revokePosthogToken(
  input: {
    apiBaseUrl: string
    clientId: string
    token: string
    hint: 'refresh_token' | 'access_token'
  },
  fetchImpl?: PosthogFetch,
): Promise<void> {
  await posthogFetchJson<unknown>(
    `${input.apiBaseUrl}/oauth/revoke/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: input.token,
        token_type_hint: input.hint,
        client_id: input.clientId,
      }).toString(),
    },
    fetchImpl,
  )
}
