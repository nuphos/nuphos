import { config } from '@/config'
import { AppError } from '@/lib/errors'

export type BackendUrlSources = {
  podNamespace?: string
  port: number
  backendUrl?: string
  publicBackendUrl?: string
}

function loopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/** A `*.svc` name never leaves the pod network, so it is in-cluster by construction. */
export function isClusterInternalUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value)

    return hostname.endsWith('.svc') || hostname.endsWith('.svc.cluster.local')
  } catch {
    return false
  }
}

/** On a local stack, this machine and a single-label container-network name (a compose service) count as internal too. */
export function isInternalRuntimeUrl(value: string): boolean {
  if (isClusterInternalUrl(value)) return true
  if (!config.localStack) return false
  try {
    const { hostname } = new URL(value)

    return loopback(hostname) || /^[a-z0-9-]+$/u.test(hostname)
  } catch {
    return false
  }
}

/** Anything that is not internal must be wss. */
export function isAllowedRemoteOpenAbUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)

    return protocol === 'wss:' || (protocol === 'ws:' && isInternalRuntimeUrl(value))
  } catch {
    return false
  }
}

/**
 * The base a runtime outside the cluster can reach. `NUPHOS_BACKEND_URL` is
 * documented as the in-cluster Service, so it qualifies only when it happens
 * to hold a public address; `NUPHOS_PUBLIC_BACKEND_URL` is the deliberate one.
 *
 * TLS is required for the same reason `isAllowedRemoteOpenAbUrl` requires
 * `wss://`: what travels here is a bearer that vends the team's cloud
 * credentials. Plain HTTP is allowed only on loopback off-cluster, which is
 * local development.
 */
export function pickPublicBackendUrl(sources: BackendUrlSources): string | undefined {
  for (const candidate of [sources.publicBackendUrl, sources.backendUrl]) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      const devLoopback =
        url.protocol === 'http:' && loopback(url.hostname) && !sources.podNamespace

      if (url.protocol !== 'https:' && !devLoopback) continue
      if (isClusterInternalUrl(candidate)) continue

      return candidate.replace(/\/$/, '')
    } catch {
      continue
    }
  }

  return undefined
}

/** In-cluster runtimes stay on the Service; a self-hosted one needs the public base. */
export function pickRuntimeBackendUrl(
  external: boolean | undefined,
  sources: BackendUrlSources,
): string | undefined {
  if (external) return pickPublicBackendUrl(sources)
  if (sources.podNamespace)
    return `http://nuphos-backend.${sources.podNamespace}.svc:${String(sources.port)}`

  return sources.backendUrl
}

function sources(): BackendUrlSources {
  return {
    podNamespace: config.otel.podNamespace,
    port: config.port,
    backendUrl: config.agent.backendUrl,
    publicBackendUrl: config.agent.publicBackendUrl,
  }
}

export function publicBackendUrl(): string | undefined {
  return pickPublicBackendUrl(sources())
}

export function runtimeBackendUrl(external: boolean | undefined): string | undefined {
  return pickRuntimeBackendUrl(external, sources())
}

export function requirePublicBackendUrl(): string {
  const base = publicBackendUrl()

  if (base) return base

  throw new AppError(
    503,
    'public_backend_url_unconfigured',
    'This Nuphos deployment has no publicly reachable backend URL, so a ' +
      'self-hosted agent could reach neither Nuphos tools nor the skill ' +
      'bundle. Set NUPHOS_PUBLIC_BACKEND_URL on the backend, then register ' +
      'the agent again.',
  )
}
