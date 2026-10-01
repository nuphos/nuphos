import { isIP } from 'node:net'

import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { findTailscaleClient } from '@/lib/byos/account'
import { decryptTailscaleClientSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'

import type { DatabaseNetworkMode, DatabaseTailscaleNetwork } from '@/models'
import type { MongoClientOptions } from 'mongodb'

export type MongoNetworkOptions = Pick<
  MongoClientOptions,
  'proxyHost' | 'proxyPort' | 'proxyUsername' | 'proxyPassword'
>

export type DatabaseNetworkPath = {
  mode: DatabaseNetworkMode
  executionPlane: 'backend' | 'tailscale-tsnet'
  bindingId: string | null
  tag: string | null
}

export type ResolvedDatabaseNetwork = {
  mongoOptions: MongoNetworkOptions
  path: DatabaseNetworkPath
}

type DialerResponse = {
  host?: unknown
  port?: unknown
  username?: unknown
  password?: unknown
}

export function isDatabaseDialerLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()

  if (normalized === '::1') return true
  if (isIP(normalized) !== 4) return false

  return normalized.split('.')[0] === '127'
}

function loopbackUrl(raw: string): URL {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    throw new AppError(
      500,
      'database_tailscale_dialer_invalid',
      'The Tailscale database dialer URL is invalid.',
    )
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (url.protocol !== 'http:' || !isDatabaseDialerLoopbackHost(hostname)) {
    throw new AppError(
      500,
      'database_tailscale_dialer_invalid',
      'The Tailscale database dialer must use an HTTP loopback URL.',
    )
  }

  return url
}

function loopbackHost(host: unknown): string {
  if (typeof host !== 'string') throw new Error('missing proxy host')
  if (!isDatabaseDialerLoopbackHost(host)) throw new Error('proxy host is not loopback')

  return host
}

function bindingObjectId(value: DatabaseTailscaleNetwork['bindingId']): ObjectId {
  return value instanceof ObjectId ? value : new ObjectId(value)
}

export function assertDatabaseNetworkConfiguration(
  networkMode: DatabaseNetworkMode,
  tailscale: DatabaseTailscaleNetwork | undefined,
): void {
  if (networkMode === 'cluster-relay') {
    throw new AppError(
      422,
      'database_network_mode_unavailable',
      'Cluster relay database connectivity is not available yet.',
    )
  }
  if (networkMode === 'tailscale' && !tailscale) {
    throw new AppError(
      422,
      'database_tailscale_binding_required',
      'Select a Tailscale OAuth binding and tag.',
    )
  }
  if (networkMode === 'public' && tailscale) {
    throw new AppError(
      422,
      'database_tailscale_configuration_unexpected',
      'Tailscale configuration is only valid in tailscale network mode.',
    )
  }
}

export async function resolveDatabaseNetwork(
  teamId: ObjectId,
  networkMode: DatabaseNetworkMode,
  tailscale: DatabaseTailscaleNetwork | undefined,
): Promise<ResolvedDatabaseNetwork> {
  assertDatabaseNetworkConfiguration(networkMode, tailscale)
  if (networkMode === 'public') {
    return {
      mongoOptions: {},
      path: { mode: 'public', executionPlane: 'backend', bindingId: null, tag: null },
    }
  }

  const selection = tailscale!
  const bindingId = bindingObjectId(selection.bindingId)
  const binding = await findTailscaleClient(teamId, bindingId)

  if (!binding) {
    throw new AppError(
      422,
      'database_tailscale_binding_not_found',
      'The selected Tailscale OAuth binding is no longer available to this team.',
    )
  }

  // The dialer authenticates tsnet with a credential it holds for the lifetime
  // of the identity, and caches identities by a fingerprint of that credential.
  // A federated binding has no such credential — minting a fresh auth key per
  // request would rebuild the tsnet identity on every query. Say so plainly
  // rather than degrading silently; federated bindings still serve the agent
  // and API paths.
  if (binding.federation) {
    throw new AppError(
      422,
      'database_tailscale_federated_unsupported',
      'Tailscale database connectivity needs an OAuth-client binding. Federated bindings cannot be used for database connections yet.',
    )
  }

  if (!binding.encryptedClientSecret) {
    throw new AppError(
      422,
      'database_tailscale_binding_incomplete',
      'The selected Tailscale binding has no client secret to reach the private network with.',
    )
  }

  const dialerUrl = config.byos.database.tailscaleDialerUrl
  const dialerToken = config.byos.database.tailscaleDialerToken

  if (!dialerUrl || !dialerToken) {
    throw new AppError(
      503,
      'database_tailscale_dialer_unavailable',
      'Tailscale database connectivity is not configured on this backend.',
    )
  }
  const baseUrl = loopbackUrl(dialerUrl)
  const endpoint = new URL('/v1/proxies', baseUrl)
  const hostname = `nuphos-db-${teamId.toHexString().slice(-6)}-${bindingId.toHexString().slice(-6)}`

  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${dialerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identityKey: `${teamId.toHexString()}:${bindingId.toHexString()}`,
        hostname,
        clientSecret: decryptTailscaleClientSecret(binding.encryptedClientSecret),
        tag: selection.tag,
      }),
      signal: AbortSignal.timeout(config.byos.database.tailscaleDialerTimeoutMs),
    })
  } catch {
    throw new AppError(
      503,
      'database_tailscale_dialer_unavailable',
      'The local Tailscale database dialer did not respond.',
    )
  }

  if (!response.ok) {
    let reason = `HTTP ${String(response.status)}`

    try {
      const body = (await response.json()) as { error?: unknown }

      if (typeof body.error === 'string') reason = body.error.slice(0, 512)
    } catch {
      // Keep the bounded status fallback. Never include the request body: it
      // contains the OAuth client secret.
    }
    throw new AppError(
      502,
      'database_tailscale_dialer_failed',
      `Tailscale private network setup failed: ${reason}`,
    )
  }

  let payload: DialerResponse

  try {
    payload = (await response.json()) as DialerResponse
  } catch {
    throw new AppError(
      502,
      'database_tailscale_dialer_invalid_response',
      'The Tailscale database dialer returned an invalid response.',
    )
  }
  try {
    const host = loopbackHost(payload.host)

    if (
      !Number.isInteger(payload.port) ||
      Number(payload.port) < 1 ||
      Number(payload.port) > 65_535
    )
      throw new Error('invalid proxy port')
    if (
      payload.username !== 'tsnet' ||
      typeof payload.password !== 'string' ||
      payload.password.length < 1
    )
      throw new Error('invalid proxy credentials')

    return {
      mongoOptions: {
        proxyHost: host,
        proxyPort: Number(payload.port),
        proxyUsername: payload.username,
        proxyPassword: payload.password,
      },
      path: {
        mode: 'tailscale',
        executionPlane: 'tailscale-tsnet',
        bindingId: bindingId.toHexString(),
        tag: selection.tag,
      },
    }
  } catch {
    throw new AppError(
      502,
      'database_tailscale_dialer_invalid_response',
      'The Tailscale database dialer returned an invalid loopback proxy.',
    )
  }
}
