import { mintNuphosOidcToken } from '@/lib/byos/aws-oidc'

export const TAILSCALE_API = 'https://api.tailscale.com/api/v2'

export type TailscaleOAuthHandle = {
  clientId: string
  clientSecret: string
}

/**
 * A binding that authenticates by workload identity federation: the customer
 * registers `https://nuphos.ai` as a trusted OIDC issuer on their tailnet, and
 * Nuphos proves who it is with a freshly signed JWT. Nothing long-lived is
 * stored on our side, which is the same posture the AWS/GCP/Azure connectors
 * already have.
 */
export type TailscaleFederatedHandle = {
  clientId: string
  audience: string
  teamId: string
}

export type TailscaleAuthHandle = TailscaleOAuthHandle | TailscaleFederatedHandle

function isFederated(handle: TailscaleAuthHandle): handle is TailscaleFederatedHandle {
  return 'audience' in handle
}

/**
 * What Tailscale expects in the JWT's `aud` when the trust credential is created
 * without an explicit audience — it echoes this back as `audience` on creation.
 * Stored per binding anyway, since an admin may override it.
 */
export function tailscaleFederationAudience(clientId: string): string {
  return `api.tailscale.com/${clientId}`
}

export type TailscaleAccessToken = {
  accessToken: string
  tokenType: string
  expiresAt: string
  scope: string | null
}

type TokenResponse = {
  access_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export class TailscaleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TailscaleApiError'
  }
}

export async function mintTailscaleAccessToken(
  handle: TailscaleAuthHandle,
  options: { scope?: string; tags?: string } = {},
): Promise<TailscaleAccessToken> {
  const federated = isFederated(handle)
  const body = federated
    ? new URLSearchParams({
        client_id: handle.clientId,
        jwt: mintNuphosOidcToken(handle.teamId, handle.audience),
      })
    : new URLSearchParams({
        client_id: handle.clientId,
        client_secret: handle.clientSecret,
        grant_type: 'client_credentials',
      })

  if (options.scope) body.set('scope', options.scope)
  if (options.tags) body.set('tags', options.tags)

  const endpoint = federated ? '/oauth/token-exchange' : '/oauth/token'
  const res = await fetch(`${TAILSCALE_API}${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  let payload: TokenResponse | null = null

  try {
    payload = (await res.json()) as TokenResponse
  } catch {
    // status fallback below
  }
  if (!res.ok || !payload?.access_token) {
    const message =
      payload?.error_description ??
      payload?.error ??
      `Tailscale OAuth token endpoint returned HTTP ${String(res.status)}`

    throw new TailscaleApiError(res.status, message)
  }
  const expiresIn = Number.isFinite(payload.expires_in) ? payload.expires_in! : 3600

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type ?? 'Bearer',
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: payload.scope ?? null,
  }
}

export async function verifyTailscaleOAuthClient(
  handle: TailscaleAuthHandle,
): Promise<TailscaleAccessToken> {
  return mintTailscaleAccessToken(handle)
}
