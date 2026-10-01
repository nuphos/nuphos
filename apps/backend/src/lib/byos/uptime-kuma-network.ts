import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

import { UptimeKumaApiError } from './uptime-kuma-core'

import type { LookupAddress, LookupOptions } from 'node:dns'
import type { LookupFunction } from 'node:net'

const ALLOWED_UPTIME_KUMA_PORTS = new Set(['80', '443', '3001'])

export function normalizeUptimeKumaBaseUrl(baseUrl: string): string {
  let end = baseUrl.length

  while (end > 0 && baseUrl[end - 1] === '/') end -= 1

  return baseUrl.slice(0, end)
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')

  if (parts.length !== 4) return null
  let n = 0

  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)

    if (v < 0 || v > 255) return null
    n = (n << 8) | v
  }

  return n >>> 0
}

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip)

  if (n === null) return false
  const inRange = (cidr: number, bits: number) => n >>> (32 - bits) === cidr >>> (32 - bits)

  return (
    inRange(0x00000000, 8) ||
    inRange(0x0a000000, 8) ||
    inRange(0x64400000, 10) ||
    inRange(0x7f000000, 8) ||
    inRange(0xa9fe0000, 16) ||
    inRange(0xac100000, 12) ||
    inRange(0xc0a80000, 16) ||
    inRange(0xe0000000, 4) ||
    inRange(0xf0000000, 4)
  )
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0]!

  if (lower === '::' || lower === '::1') return true
  if (/^fe[89ab]/.test(lower)) return true
  if (/^f[cd]/.test(lower)) return true
  if (lower.startsWith('ff')) return true
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice('::ffff:'.length)

    if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return isBlockedIPv4(tail)
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)

    if (hex) {
      const a = parseInt(hex[1]!, 16)
      const b = parseInt(hex[2]!, 16)
      const dotted = `${String((a >> 8) & 0xff)}.${String(a & 0xff)}.${String((b >> 8) & 0xff)}.${String(b & 0xff)}`

      return isBlockedIPv4(dotted)
    }
  }

  return false
}

function isBlockedAddress(address: string): boolean {
  const kind = net.isIP(address)

  if (kind === 4) return isBlockedIPv4(address)
  if (kind === 6) return isBlockedIPv6(address)

  return false
}

export function blockedUptimeKumaHostReason(rawUrl: string): string | null {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'invalid URL'
  }
  if (parsed.username || parsed.password) {
    return 'baseUrl must not contain embedded credentials'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'baseUrl must be http:// or https://'
  }
  if (parsed.port && !ALLOWED_UPTIME_KUMA_PORTS.has(parsed.port)) {
    return 'baseUrl port must be 80, 443, or 3001'
  }
  const raw = parsed.hostname.toLowerCase()
  const unbracketed = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw
  const host = unbracketed.split('%')[0]!

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'localhost / .local hosts are not allowed'
  }
  if (isBlockedAddress(host)) {
    return 'private / loopback / reserved IP not allowed'
  }

  return null
}

export async function assertResolvedBaseUrlAllowed(baseUrl: string): Promise<void> {
  const literalReason = blockedUptimeKumaHostReason(baseUrl)

  if (literalReason) {
    throw new UptimeKumaApiError(400, literalReason)
  }

  const { hostname } = new URL(baseUrl)
  const host = hostname.toLowerCase().split('%')[0]!

  if (net.isIP(host)) return

  let addresses: LookupAddress[]

  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    throw new UptimeKumaApiError(502, `Could not resolve Uptime Kuma host ${host}`)
  }
  if (addresses.length === 0) {
    throw new UptimeKumaApiError(502, `Could not resolve Uptime Kuma host ${host}`)
  }
  if (addresses.some((item) => isBlockedAddress(item.address))) {
    throw new UptimeKumaApiError(
      400,
      'Uptime Kuma host resolves to a private / loopback / reserved IP',
    )
  }
}

function blockedDnsError(message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException

  err.code = 'EACCES'

  return err
}

const safeLookup: LookupFunction = (hostname, options: LookupOptions, callback) => {
  void (async () => {
    let addresses: LookupAddress[]

    try {
      addresses = await dns.lookup(hostname, {
        family: options.family,
        hints: options.hints,
        all: true,
        verbatim: true,
      })
    } catch (err) {
      callback(err as NodeJS.ErrnoException, '', 0)

      return
    }

    if (addresses.length === 0) {
      callback(blockedDnsError(`Could not resolve Uptime Kuma host ${hostname}`), '', 0)

      return
    }
    if (addresses.some((item) => isBlockedAddress(item.address))) {
      callback(
        blockedDnsError('Uptime Kuma host resolves to a private / loopback / reserved IP'),
        '',
        0,
      )

      return
    }

    if (options.all) {
      callback(null, addresses)

      return
    }
    const address = addresses[0]!

    callback(null, address.address, address.family)
  })()
}

export function safeAgentForUrl(baseUrl: string): http.Agent | https.Agent {
  const options = { keepAlive: false, lookup: safeLookup }

  return new URL(baseUrl).protocol === 'https:' ? new https.Agent(options) : new http.Agent(options)
}
