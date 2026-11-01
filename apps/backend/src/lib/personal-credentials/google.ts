// Google OAuth for the Gmail and Google Drive Personal Credentials. Each team
// brings its own OAuth client (Team settings); each provider is its own grant
// with one scope, issued by the team's client.
import { decryptLinearSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { getGoogleProfile } from '@/lib/identity/google'
import { parseObjectId } from '@/lib/objectid'
import { teamByosBindings } from '@/models'

import type { ProviderTokens } from './github'

export type GoogleProvider = 'gmail' | 'google-drive'

export const GOOGLE_PROVIDERS: readonly GoogleProvider[] = ['gmail', 'google-drive']

const SCOPES: Record<GoogleProvider, string> = {
  gmail: 'https://www.googleapis.com/auth/gmail.modify',
  'google-drive': 'https://www.googleapis.com/auth/drive',
}

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export function isGoogleProvider(provider: string): provider is GoogleProvider {
  return (GOOGLE_PROVIDERS as readonly string[]).includes(provider)
}

export type GoogleClient = { clientId: string; clientSecret: string }

/** The team's own OAuth client, or null when its admins have not added one. */
export async function teamGoogleClient(teamId: string): Promise<GoogleClient | null> {
  const doc = await teamByosBindings().findOne(
    { _id: parseObjectId(teamId, 'teamId') },
    { projection: { googleOAuthClient: 1 } },
  )
  const stored = doc?.googleOAuthClient

  return stored
    ? { clientId: stored.clientId, clientSecret: decryptLinearSecret(stored.encryptedClientSecret) }
    : null
}

/** Gmail / Google Drive connect through a team the member belongs to, with that team's client. */
export async function googleTeamFor(userId: string, teamId: string | undefined): Promise<string> {
  if (!teamId || !(await getTeamMembership(userId, teamId))) {
    throw new AppError(403, 'forbidden', 'Connect Gmail or Google Drive from a team you belong to')
  }
  if (!(await teamGoogleClient(teamId))) {
    throw new AppError(
      409,
      'google_oauth_client_not_configured',
      'This team has not added a Google OAuth client yet. An administrator can add one in Team settings.',
    )
  }

  return teamId
}

export function googleAuthorizeUrl(args: {
  provider: GoogleProvider
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: `openid email ${SCOPES[args.provider]}`,
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    // A refresh token is only issued with offline access on a fresh consent.
    access_type: 'offline',
    prompt: 'consent',
  })

  return `${AUTHORIZE_URL}?${params.toString()}`
}

/** A token endpoint answer; 4xx means the grant itself was refused. */
export class GoogleOAuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function tokenRequest(body: Record<string, string>): Promise<ProviderTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  })
  const raw = (await res.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
    error?: string
    error_description?: string
  }

  if (!res.ok || !raw.access_token) {
    throw new GoogleOAuthError(
      res.status,
      `Google token request failed: ${raw.error_description ?? raw.error ?? String(res.status)}`,
    )
  }

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: raw.expires_in ? new Date(Date.now() + raw.expires_in * 1000) : null,
  }
}

export function exchangeGoogleCode(args: {
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
    grant_type: 'authorization_code',
  })
}

export function refreshGoogleToken(
  client: GoogleClient,
  refreshToken: string,
): Promise<ProviderTokens> {
  return tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

export async function getGoogleUser(token: string): Promise<{ id: string; login: string }> {
  const profile = await getGoogleProfile(token)

  return { id: profile.id, login: profile.email }
}

/**
 * Best-effort. Google revokes the member's whole grant to the client, which
 * covers both Google providers of a team, so callers only revoke the last one.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(10_000),
  })
}
