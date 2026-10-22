import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'node:stream'

import { config } from '@/config'

import type { LookupAddress, LookupOptions } from 'node:dns'
import type { LookupFunction } from 'node:net'

/**
 * The one guard for requests to a host a team configured (Grafana, GitLab,
 * SonarQube, Uptime Kuma, databases). The host is resolved immediately before
 * each request, every resolved address is classified, and the connection is
 * pinned to the checked address so a second resolution cannot swap it.
 * Redirects are never followed: a public server must not be able to send a
 * credential-bearing request on to a private one.
 */
export class OutboundBlockedError extends Error {
  constructor(
    message: string,
    /** 400 for a refused destination, 502 when the host cannot be resolved. */
    readonly status: 400 | 502,
  ) {
    super(message)
    this.name = 'OutboundBlockedError'
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
  ['192.88.99.0', 24],
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
// IPv4-mapped addresses (::ffff:a.b.c.d) need no rule of their own: BlockList
// classifies them by the embedded IPv4 address. A ::ffff:0.0.0.0/96 rule would
// match every IPv4 address. Translated forms (NAT64, 6to4, Teredo) are refused.
for (const [network, prefix] of [
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6')
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address)

  if (family === 4) return blockedAddresses.check(address, 'ipv4')
  if (family === 6) return blockedAddresses.check(address, 'ipv6')

  return true
}

/** Lowercased, unbracketed, without zone id or the trailing root dot. */
function bareHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase()
  const unbracketed =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  let bare = unbracketed.split('%')[0]!

  while (bare.endsWith('.')) bare = bare.slice(0, -1)

  return bare
}

/** Why `raw` may not be configured as a base URL, from the URL alone. */
export function blockedUrlReason(raw: string): string | null {
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
  if (config.byos.outbound.allowPrivateHosts) return null
  const host = bareHostname(url)

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'localhost / .local hosts are not allowed'
  }
  if (net.isIP(host) && isBlockedAddress(host)) {
    return 'private / loopback / reserved IP is not allowed'
  }

  return null
}

export type ResolvedTarget = LookupAddress & { hostname: string }

export type HostLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>

const systemLookup: HostLookup = async (hostname, options) => await dns.lookup(hostname, options)

/** Resolve and classify the host of `raw` immediately before a request. */
export async function resolvePublicTarget(
  raw: string,
  lookup: HostLookup = systemLookup,
): Promise<ResolvedTarget> {
  const reason = blockedUrlReason(raw)

  if (reason) throw new OutboundBlockedError(reason, 400)
  const host = bareHostname(new URL(raw))
  const literalFamily = net.isIP(host)

  if (literalFamily) return { hostname: host, address: host, family: literalFamily }
  let addresses: LookupAddress[]

  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    throw new OutboundBlockedError(`Could not resolve host ${host}: ${detail}`, 502)
  }
  if (addresses.length === 0) throw new OutboundBlockedError(`Could not resolve host ${host}`, 502)
  if (
    !config.byos.outbound.allowPrivateHosts &&
    addresses.some((entry) => isBlockedAddress(entry.address))
  ) {
    throw new OutboundBlockedError(
      `Host ${host} resolves to a private / loopback / reserved IP`,
      400,
    )
  }
  const target = addresses.find((entry) => entry.family === 4) ?? addresses[0]!

  return { hostname: host, address: target.address, family: target.family }
}

function pinnedLookup(target: ResolvedTarget): LookupFunction {
  return (_hostname, options: LookupOptions, callback) => {
    if (options.all) {
      callback(null, [{ address: target.address, family: target.family }])

      return
    }
    callback(null, target.address, target.family)
  }
}

/**
 * A lookup for long-lived clients (Socket.IO, database drivers) that connect
 * on their own: each connection resolves, is classified, and uses only a
 * checked address. Requires Bun ≥ 1.4.3, which honours `lookup` on agents.
 */
export const safeLookup: LookupFunction = (hostname, options: LookupOptions, callback) => {
  void (async () => {
    let target: ResolvedTarget

    try {
      const host = hostname.includes(':') ? `[${hostname}]` : hostname

      target = await resolvePublicTarget(`http://${host}/`)
    } catch (error) {
      const err = error as NodeJS.ErrnoException

      err.code = 'EACCES'
      callback(err, '', 0)

      return
    }
    pinnedLookup(target)(hostname, options, callback)
  })()
}

export type PinnedRequestInput = {
  url: URL
  method: string
  headers: Headers
  body?: string | Uint8Array
  signal?: AbortSignal
  target: ResolvedTarget
}

/** Callers only show a short message from an error, so its body is not read past this;
 * other bodies are streamed. */
export const ERROR_BODY_LIMIT = 64 * 1024

/** One request over a connection pinned to `target`; redirects are returned, not followed. */
export async function pinnedRequest(input: PinnedRequestInput): Promise<Response> {
  return await new Promise<Response>((resolve, reject) => {
    const client = input.url.protocol === 'https:' ? https : http
    const request = client.request(
      input.url,
      {
        method: input.method,
        headers: Object.fromEntries(input.headers.entries()),
        lookup: pinnedLookup(input.target),
        signal: input.signal,
      },
      (response) => {
        const status = response.statusCode ?? 502
        const headers = new Headers(
          Object.entries(response.headers).flatMap(([name, value]) =>
            [value ?? []].flat().map((item): [string, string] => [name, item]),
          ),
        )

        if (status < 400) {
          // Streamed, so a large or endless body is never held in memory.
          const empty = status === 204 || status === 304 || input.method === 'HEAD'

          if (empty) response.resume()
          resolve(
            new Response(
              empty ? null : (Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>),
              { status, headers },
            ),
          )

          return
        }
        const chunks: Buffer[] = []
        let size = 0

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk.subarray(0, ERROR_BODY_LIMIT - size))
          size += chunk.length
          if (size >= ERROR_BODY_LIMIT) {
            response.destroy()
            finish()
          }
        })
        response.on('error', reject)
        response.on('end', finish)

        function finish() {
          const body = Buffer.concat(chunks)

          headers.delete('content-length')
          resolve(new Response(body.length === 0 ? null : body, { status, headers }))
        }
      },
    )

    request.on('error', reject)
    request.end(input.body)
  })
}

/** `fetch` for a team-configured host: resolved, classified and pinned per call. */
export async function pinnedFetch(
  raw: string,
  init: {
    method?: string
    headers?: NonNullable<ConstructorParameters<typeof Headers>[0]>
    body?: string | Uint8Array | null
    signal?: AbortSignal
  } = {},
): Promise<Response> {
  const target = await resolvePublicTarget(raw)
  const headers = new Headers(init.headers)

  // Node's client does not decode bodies; ask for them plain.
  headers.set('accept-encoding', 'identity')

  return await pinnedRequest({
    url: new URL(raw),
    method: init.method ?? 'GET',
    headers,
    body: init.body ?? undefined,
    signal: init.signal,
    target,
  })
}
