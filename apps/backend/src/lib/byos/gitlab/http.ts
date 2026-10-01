import { lookup as dnsLookup } from 'node:dns/promises'

import { config } from '@/config'

export const USER_AGENT = 'nuphos-backend'
export const GITLAB_FETCH_TIMEOUT_MS = 30_000

export class GitlabApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class GitlabOAuthNotConfigured extends Error {
  constructor() {
    super('GitLab OAuth defaults are not configured (set GITLAB_OAUTH_CLIENT_ID/SECRET)')
  }
}

export async function gitlabFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    const parsed = new URL(url)

    await assertHostResolvesPublic(parsed.hostname)
  } catch (e) {
    if (e instanceof GitlabApiError) throw e
    throw new GitlabApiError(502, e instanceof Error ? e.message : 'host resolution failed')
  }
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(GITLAB_FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GitlabApiError(
        504,
        `GitLab request timed out after ${String(GITLAB_FETCH_TIMEOUT_MS)}ms`,
      )
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new GitlabApiError(502, `GitLab request failed: ${message}`)
  }
}

// Hostnames an admin must never be allowed to point a binding at — these
// would let the backend POST OAuth code/secret pairs (and subsequently call
// /api/v4/user) against loopback, link-local, RFC1918, or cloud-metadata
// endpoints, classic SSRF surface. Bypassable in dev by setting
// GITLAB_ALLOW_PRIVATE_HOSTS=true (for local self-hosted testing).
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()

  if (h === 'localhost' || h.endsWith('.localhost')) return true
  // Literal IPv6 loopback / unspecified, optionally bracketed by URL parser.
  if (h === '::1' || h === '[::1]' || h === '::' || h === '[::]') return true

  return isPrivateIp(h)
}

// Reserved/private IP check shared by the literal-hostname gate above and the
// runtime DNS gate below. Returns true for an address that we should refuse
// to send outbound traffic to.
function isPrivateIp(address: string): boolean {
  const h = address.toLowerCase()
  // IPv4 dotted-quad → bucket into reserved ranges.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)

  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]

    if (a === 0) return true // 0.0.0.0/8
    if (a === 10) return true // RFC1918
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local + IMDS (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
    if (a === 192 && b === 168) return true // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (RFC6598)

    return false
  }
  // IPv6 loopback / unspecified literals. dns.lookup never returns bracketed
  // form, but accept both shapes defensively.
  if (h === '::1' || h === '[::1]' || h === '::' || h === '[::]') return true
  // Common private prefixes (fc00::/7 unique-local, fe80::/10 link-local).
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true
  // IPv4-mapped IPv6 (::ffff:10.0.0.1 etc): re-check the embedded v4.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h)

  if (mapped?.[1]) return isPrivateIp(mapped[1])

  return false
}

function allowPrivateHosts(): boolean {
  return config.byos.gitlab.allowPrivateHosts
}

// Defends against DNS-rebinding / public-name-to-private-IP SSRF: even if a
// hostname looks public, the *resolved* IP might be RFC1918, loopback, or a
// cloud-metadata endpoint. We resolve at request time and refuse the call if
// any returned address is private. There's still a small TOCTOU window vs.
// fetch's own resolution, but for credential-bearing outbound HTTP this
// closes the obvious bypass.
async function assertHostResolvesPublic(hostname: string): Promise<void> {
  if (allowPrivateHosts()) return
  // Strip optional IPv6 brackets that may have come from URL.hostname-like
  // sources; dns.lookup wants the bare address.
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  let addresses: { address: string; family: number }[]

  try {
    addresses = await dnsLookup(bare, { all: true, verbatim: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'DNS lookup failed'

    throw new GitlabApiError(502, `Failed to resolve GitLab host ${hostname}: ${message}`)
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new GitlabApiError(
        400,
        `GitLab host ${hostname} resolves to private/loopback address ${address}; refusing to issue an outbound request. Set GITLAB_ALLOW_PRIVATE_HOSTS=true on the backend if this is intentional in a development environment.`,
      )
    }
  }
}

export function normalizeHostUrl(input: string): string {
  let url: URL

  try {
    url = new URL(input)
  } catch {
    throw new GitlabApiError(400, `Invalid GitLab host URL: ${input}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GitlabApiError(400, `GitLab host URL must use http or https (got ${url.protocol})`)
  }
  if (isPrivateHost(url.hostname) && !allowPrivateHosts()) {
    throw new GitlabApiError(
      400,
      `GitLab host URL points at a private/loopback/metadata address (${url.hostname}); refusing to issue an outbound OAuth request to it. Set GITLAB_ALLOW_PRIVATE_HOSTS=true on the backend if this is intentional in a development environment.`,
    )
  }

  // Strip trailing slashes + the path; we only want origin.
  return url.origin
}

export function isDefaultHost(hostUrl: string): boolean {
  return normalizeHostUrl(hostUrl) === 'https://gitlab.com'
}
