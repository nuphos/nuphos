import http from 'node:http'
import https from 'node:https'

import {
  blockedUrlReason,
  OutboundBlockedError,
  resolvePublicTarget,
  safeLookup,
} from '@/lib/net/safe-outbound'

import { UptimeKumaApiError } from './uptime-kuma-core'

const ALLOWED_UPTIME_KUMA_PORTS = new Set(['80', '443', '3001'])

export function normalizeUptimeKumaBaseUrl(baseUrl: string): string {
  let end = baseUrl.length

  while (end > 0 && baseUrl[end - 1] === '/') end -= 1

  return baseUrl.slice(0, end)
}

export function blockedUptimeKumaHostReason(rawUrl: string): string | null {
  const reason = blockedUrlReason(rawUrl)

  if (reason) return reason
  const { port } = new URL(rawUrl)

  if (port && !ALLOWED_UPTIME_KUMA_PORTS.has(port)) return 'baseUrl port must be 80, 443, or 3001'

  return null
}

/** Fails fast with a readable error; the agent's lookup re-checks every connection. */
export async function assertResolvedBaseUrlAllowed(baseUrl: string): Promise<void> {
  const reason = blockedUptimeKumaHostReason(baseUrl)

  if (reason) throw new UptimeKumaApiError(400, reason)
  try {
    await resolvePublicTarget(baseUrl)
  } catch (error) {
    if (!(error instanceof OutboundBlockedError)) throw error
    throw new UptimeKumaApiError(error.status, `Uptime Kuma ${error.message}`)
  }
}

export function safeAgentForUrl(baseUrl: string): http.Agent | https.Agent {
  const options = { keepAlive: false, lookup: safeLookup }

  return new URL(baseUrl).protocol === 'https:' ? new https.Agent(options) : new http.Agent(options)
}
