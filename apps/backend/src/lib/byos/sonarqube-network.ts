import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

import type { LookupAddress, LookupOptions } from 'node:dns'
import type { LookupFunction } from 'node:net'

export class SonarqubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly responseBody?: unknown,
  ) {
    super(message)
    this.name = 'SonarqubeApiError'
  }
}

const blockedAddresses = new net.BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4')
}

blockedAddresses.addAddress('::', 'ipv6')
blockedAddresses.addAddress('::1', 'ipv6')
for (const [network, prefix] of [
  // Reject every IPv4-mapped literal rather than trying to maintain two
  // independent classifications for the same destination.
  ['::ffff:0.0.0.0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6')
}

function bareHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase()
  const unbracketed =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  return unbracketed.split('%')[0]!
}

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address)

  if (family === 4) return blockedAddresses.check(address, 'ipv4')
  if (family === 6) return blockedAddresses.check(address, 'ipv6')

  return true
}

export function blockedSonarqubeBaseUrlReason(raw: string): string | null {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return 'invalid URL'
  }
  if (url.username || url.password) return 'URL must not contain embedded credentials'
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'URL must be http:// or https://'
  }
  const host = bareHostname(url)

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'localhost / .local hosts are not allowed; expose the development instance through an authenticated tunnel'
  }
  if (net.isIP(host) && isBlockedAddress(host)) {
    return 'private / loopback / reserved IP is not allowed'
  }

  return null
}

export type SonarqubeResolvedTarget = LookupAddress & { hostname: string }

type SonarqubeLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>

const systemLookup: SonarqubeLookup = async (hostname, options) =>
  await dns.lookup(hostname, options)

/** Resolve and classify the host immediately before each credential-bearing request. */
export async function resolvePublicSonarqubeTarget(
  baseUrl: string,
  lookup: SonarqubeLookup = systemLookup,
): Promise<SonarqubeResolvedTarget> {
  const reason = blockedSonarqubeBaseUrlReason(baseUrl)

  if (reason) throw new SonarqubeApiError(reason, 400, '/')

  const host = bareHostname(new URL(baseUrl))
  const literalFamily = net.isIP(host)

  if (literalFamily) {
    return { hostname: host, address: host, family: literalFamily }
  }

  let addresses: LookupAddress[]

  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    throw new SonarqubeApiError(`Could not resolve SonarQube host ${host}: ${detail}`, 0, '/')
  }
  if (addresses.length === 0) {
    throw new SonarqubeApiError(`Could not resolve SonarQube host ${host}`, 0, '/')
  }
  const blocked = addresses.find((entry) => isBlockedAddress(entry.address))

  if (blocked) {
    throw new SonarqubeApiError(
      `SonarQube host ${host} resolves to a private / loopback / reserved IP`,
      400,
      '/',
    )
  }

  // Prefer IPv4 when both families are available because the development
  // Docker scanner can pin it consistently across Docker Desktop versions.
  const target = addresses.find((entry) => entry.family === 4) ?? addresses[0]!

  return { hostname: host, address: target.address, family: target.family }
}

export type PinnedRequestInput = {
  url: URL
  method: 'GET' | 'POST'
  headers: Headers
  body?: string
  signal: AbortSignal
  target: SonarqubeResolvedTarget
}

export async function pinnedNodeRequest(input: PinnedRequestInput): Promise<Response> {
  const lookup: LookupFunction = (_hostname, options: LookupOptions, callback) => {
    const address = { address: input.target.address, family: input.target.family }

    if (options.all) {
      callback(null, [address])

      return
    }
    callback(null, address.address, address.family)
  }

  return await new Promise<Response>((resolve, reject) => {
    const client = input.url.protocol === 'https:' ? https : http
    const request = client.request(
      input.url,
      {
        method: input.method,
        headers: Object.fromEntries(input.headers.entries()),
        lookup,
        signal: input.signal,
      },
      (response) => {
        const chunks: Buffer[] = []

        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('error', reject)
        response.on('end', () => {
          const headers = new Headers()

          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item)
            } else if (value !== undefined) {
              headers.append(name, value)
            }
          }
          const body = Buffer.concat(chunks)

          resolve(
            new Response(body.length > 0 ? body : null, {
              status: response.statusCode ?? 502,
              headers,
            }),
          )
        })
      },
    )

    request.on('error', reject)
    request.end(input.body)
  })
}
