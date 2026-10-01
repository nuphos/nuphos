import { config } from '@/config'

export type GoogleProfile = {
  id: string
  email: string
  name: string
  picture: string
  verified_email: boolean
}

export async function getGoogleAccessToken(code: string, redirectUri: string): Promise<string> {
  const clientId = config.auth.google.clientId
  const clientSecret = config.auth.google.clientSecret

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured')
  }
  assertAllowedGoogleRedirectUri(redirectUri)

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error_description?: string
    error?: string
  }

  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ??
        json.error ??
        `Google token exchange failed: HTTP ${String(res.status)}`,
    )
  }

  return json.access_token
}

export async function getGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) throw new Error(`Google userinfo failed: HTTP ${String(res.status)}`)

  return (await res.json()) as GoogleProfile
}

function assertAllowedGoogleRedirectUri(raw: string): void {
  const url = new URL(raw)

  // Local desktop / dev clients run an ephemeral HTTP listener on a
  // random port with a client-chosen path, so we only constrain the
  // hostname here. Public hosts still require an exact callback path
  // (see the nuphos check below).
  const isLocal =
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')

  if (isLocal) return

  const isNuphos =
    url.protocol === 'https:' &&
    (url.hostname === 'nuphos.ai' || url.hostname === 'www.nuphos.ai') &&
    url.pathname === '/api/google/callback'

  if (isNuphos) return

  throw new Error('Google OAuth redirect URI is not allowed')
}
