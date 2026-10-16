/**
 * Cloudflare sets CF-Connecting-IP to the real client. The backend is also reachable
 * directly, so the value is advisory: a caller bypassing Cloudflare can forge it. Without
 * Cloudflare (self-hosted) fall back to the right-most X-Forwarded-For hop.
 */
export function clientIp(
  cfConnectingIp: string | undefined,
  forwardedFor: string | undefined,
): string | undefined {
  const candidates = [cfConnectingIp, ...(forwardedFor?.split(',').toReversed() ?? [])]

  return candidates.map((value) => value?.trim()).find(Boolean)
}

export type RequestOrigin = { ip: string; city?: string; country?: string }

/** Where a request came from; city and country only when Cloudflare's visitor location headers are on. */
export function requestOrigin(
  header: (name: string) => string | undefined,
): RequestOrigin | undefined {
  const ip = clientIp(header('CF-Connecting-IP'), header('X-Forwarded-For'))

  if (!ip) return undefined
  const city = header('CF-IPCity')?.trim()
  const country = header('CF-IPCountry')?.trim()

  return {
    ip,
    ...(city ? { city } : {}),
    // XX: unknown; T1: Tor.
    ...(country && country !== 'XX' && country !== 'T1' ? { country } : {}),
  }
}
