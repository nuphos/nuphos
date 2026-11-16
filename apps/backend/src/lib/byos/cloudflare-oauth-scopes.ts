import { config } from '@/config'

// Cloudflare rejects a whole authorize request when one scope is not registered
// on the OAuth client (invalid_scope). The registration is read with an
// "OAuth Client Read" token so only registered scopes are ever requested.

const FETCH_TIMEOUT_MS = 10_000
// Scopes requested when the caller sends no selection (mobile clients).
const DEFAULT_SCOPES = config.byos.cloudflare.oauth.scopes

// Scopes Nuphos needs whatever the user picks: account discovery after the
// grant, and zone.read so the DNS view can list zones.
const BASELINE_SCOPES = [
  'account-settings.read',
  'user-details.read',
  'memberships.read',
  'zone.read',
]
const READ_ONLY_SCOPE = /\.(read|metadata_read)$/
const REGISTRATION_TTL_MS = 10 * 60 * 1000

export type CloudflareScopeAccess = Record<string, 'read' | 'write'>

async function cloudflareGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${config.byos.cloudflare.oauth.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const payload = (await res.json().catch(() => ({}))) as {
    success?: boolean
    result?: T
    errors?: { message?: string }[]
  }

  if (!res.ok || payload.success === false || payload.result === undefined) {
    const msg = payload.errors?.find((e) => e.message)?.message ?? `HTTP ${String(res.status)}`

    throw new Error(`${path}: ${msg}`)
  }

  return payload.result
}

async function fetchRegisteredScopes(clientId: string): Promise<Map<string, string>> {
  const token = config.byos.cloudflare.oauth.adminToken

  if (!token) throw new Error('CLOUDFLARE_OAUTH_ADMIN_TOKEN is not set')
  // An account-owned token sees only its own account, the one owning the client.
  const accounts = await cloudflareGet<{ id: string }[]>(token, '/accounts')
  const client = await Promise.any(
    accounts.map((a) =>
      cloudflareGet<{ scopes?: string[] }>(token, `/accounts/${a.id}/oauth_clients/${clientId}`),
    ),
  ).catch(() => {
    throw new Error(`no account this token can read owns OAuth client ${clientId}`)
  })
  const catalog = await cloudflareGet<{ id: string; category?: string }[]>(
    token,
    '/oauth/scopes?per_page=1000',
  )
  const category = new Map(catalog.map((s) => [s.id, s.category ?? 'other']))

  return new Map((client.scopes ?? []).map((s) => [s, category.get(s) ?? 'other']))
}

let registration: { at: number; scopes: Promise<Map<string, string>> } | null = null

/** The client's registered scopes, each with its Cloudflare scope category. */
export function registeredCloudflareScopes(clientId: string): Promise<Map<string, string>> {
  if (!registration || Date.now() - registration.at > REGISTRATION_TTL_MS) {
    const scopes = fetchRegisteredScopes(clientId)

    registration = { at: Date.now(), scopes }
    // A failure is not cached; the next connect asks Cloudflare again.
    scopes.catch(() => {
      if (registration?.scopes === scopes) registration = null
    })
  }

  return registration.scopes
}

/**
 * Build the `scope` query value. `access` picks Cloudflare scope categories
 * (read: their read-only scopes, write: all of them); `scopes` is the explicit
 * list older desktops send. Only scopes the client is registered with are
 * requested, so Cloudflare never rejects the request as invalid_scope.
 * `offline_access` is always included so we get a refresh token.
 */
export async function resolveCloudflareScopeParam(
  clientId: string,
  { access, scopes }: { access?: CloudflareScopeAccess; scopes?: string[] },
): Promise<string> {
  const registered = await registeredCloudflareScopes(clientId)
  const requested = access
    ? [
        ...BASELINE_SCOPES,
        ...[...registered]
          .filter(
            ([s, c]) => access[c] === 'write' || (access[c] === 'read' && READ_ONLY_SCOPE.test(s)),
          )
          .map(([s]) => s),
      ]
    : scopes && scopes.length > 0
      ? scopes
      : DEFAULT_SCOPES.split(/\s+/)

  return [...new Set([...requested.filter((s) => registered.has(s)), 'offline_access'])].join(' ')
}
