import { config } from '@/config'
import { mcpResourceUrl } from '@/lib/oauth/metadata'

import type { Context } from 'hono'

export const ACCESS_TOKEN_TTL_SEC = 60 * 60
export const CONSENT_TOKEN_TTL_SEC = 60 * 5

// The consent page grants authorization — never allow it to be framed
// (clickjacking) or cached.
export function consentPageHeaders(c: Context): void {
  c.header('X-Frame-Options', 'DENY')
  c.header('Content-Security-Policy', "frame-ancestors 'none'")
  c.header('Cache-Control', 'no-store')
}

export function baseUrl(): string {
  return config.auth.publicBaseUrl
}
export function resourceUrl(): string {
  return mcpResourceUrl(baseUrl())
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

// Registered redirect targets must be HTTPS, or loopback HTTP for native MCP
// clients — anything else (malformed, custom schemes) is rejected up front so
// it can never become a redirect target after consent.
export function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)

    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname))
  } catch {
    return false
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
