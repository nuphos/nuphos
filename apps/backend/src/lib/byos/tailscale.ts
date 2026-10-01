import { mintTailscaleAccessToken, TAILSCALE_API, TailscaleApiError } from './tailscale-auth'

import type { TailscaleAuthHandle } from './tailscale-auth'

export type {
  TailscaleAccessToken,
  TailscaleAuthHandle,
  TailscaleFederatedHandle,
  TailscaleOAuthHandle,
} from './tailscale-auth'
export {
  mintTailscaleAccessToken,
  tailscaleFederationAudience,
  TailscaleApiError,
  verifyTailscaleOAuthClient,
} from './tailscale-auth'

export type TailscaleDevice = {
  id: string
  name: string
  hostname: string | null
  os: string | null
  user: string | null
  addresses: string[]
  tags: string[]
  online: boolean | null
  authorized: boolean | null
  createdAt: string | null
  lastSeen: string | null
  expiresAt: string | null
}

type DeviceResult = {
  id?: string
  nodeId?: string
  name?: string
  hostname?: string
  os?: string
  user?: string
  userId?: string
  addresses?: string[]
  tags?: string[]
  online?: boolean
  connectedToControl?: boolean
  authorized?: boolean
  created?: string
  createdAt?: string
  lastSeen?: string
  expires?: string
  expiresAt?: string
}

export type TailscaleAuthKey = {
  key: string
  expiresAt: string
}

async function tailscaleGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${TAILSCALE_API}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    let reason = `HTTP ${String(res.status)}`

    try {
      const body = (await res.json()) as { message?: string; error?: string }

      reason = body.message ?? body.error ?? reason
    } catch {
      // ignore
    }
    throw new TailscaleApiError(res.status, reason)
  }

  return res.json() as Promise<T>
}

async function tailscalePost<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${TAILSCALE_API}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    let reason = `HTTP ${String(res.status)}`

    try {
      const payload = (await res.json()) as { message?: string; error?: string }

      reason = payload.message ?? payload.error ?? reason
    } catch {
      // ignore
    }
    throw new TailscaleApiError(res.status, reason)
  }

  return res.json() as Promise<T>
}

/**
 * Mint a single-use auth key that lets one sandbox join the customer's tailnet
 * as `tag`, then disappear.
 *
 * The sandbox never receives the OAuth client secret: that secret is long-lived
 * and can mint unlimited keys for every tag the client owns, while the agent it
 * would be handed to runs arbitrary bash. This key is the narrowest credential
 * that still does the job — ephemeral so the node is reaped on disconnect,
 * non-reusable so a leaked key buys one join, and tag-locked so the tailnet ACL
 * remains the authorization boundary.
 *
 * `preauthorized` matters on tailnets with device approval turned on: without it
 * every session would block on a human approving the node.
 */
export async function createTailscaleAuthKey(
  handle: TailscaleAuthHandle,
  options: { tag: string; description: string; expirySeconds: number },
): Promise<TailscaleAuthKey> {
  const token = await mintTailscaleAccessToken(handle)
  const created = await tailscalePost<{ key?: string; expires?: string }>(
    token.accessToken,
    '/tailnet/-/keys',
    {
      capabilities: {
        devices: {
          create: {
            reusable: false,
            ephemeral: true,
            preauthorized: true,
            tags: [options.tag],
          },
        },
      },
      expirySeconds: options.expirySeconds,
      description: options.description,
    },
  )

  if (!created.key) {
    throw new TailscaleApiError(502, 'Tailscale did not return an auth key')
  }

  return {
    key: created.key,
    expiresAt: created.expires ?? new Date(Date.now() + options.expirySeconds * 1000).toISOString(),
  }
}

// Tailscale's v2 /tailnet/{tailnet}/devices endpoint does not include a top-level
// `online` field — their official admin dashboard derives the green "Connected"
// indicator from `connectedToControl` (real-time control-plane connection) with
// a `lastSeen < ~5 min` fallback for older clients that don't expose it.
// Mirror that so desktop and agent see the same semantics as the Tailscale console.
const TAILSCALE_CONNECTED_WINDOW_MS = 5 * 60 * 1000

function deriveDeviceOnline(device: DeviceResult): boolean | null {
  if (typeof device.online === 'boolean') return device.online
  if (typeof device.connectedToControl === 'boolean') return device.connectedToControl
  if (!device.lastSeen) return null
  const lastSeenMs = Date.parse(device.lastSeen)

  if (Number.isNaN(lastSeenMs)) return null

  return Date.now() - lastSeenMs < TAILSCALE_CONNECTED_WINDOW_MS
}

export async function listTailscaleDevices(
  handle: TailscaleAuthHandle,
): Promise<TailscaleDevice[]> {
  const token = await mintTailscaleAccessToken(handle)
  const data = await tailscaleGet<{ devices?: DeviceResult[] }>(
    token.accessToken,
    '/tailnet/-/devices',
  )

  return (data.devices ?? []).map((device) => ({
    id: device.id ?? device.nodeId ?? device.name ?? '',
    name: device.name ?? device.hostname ?? device.id ?? '',
    hostname: device.hostname ?? null,
    os: device.os ?? null,
    user: device.user ?? device.userId ?? null,
    addresses: device.addresses ?? [],
    tags: device.tags ?? [],
    online: deriveDeviceOnline(device),
    authorized: device.authorized ?? null,
    createdAt: device.createdAt ?? device.created ?? null,
    lastSeen: device.lastSeen ?? null,
    expiresAt: device.expiresAt ?? device.expires ?? null,
  }))
}
