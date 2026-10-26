/**
 * Cloudflare sets CF-Connecting-IP to the real client. Hosted Nuphos (api.nuphos.ai) enforces
 * Cloudflare Authenticated Origin Pulls, so there the header is trusted. Self-hosted, the
 * backend may be reachable directly and a caller bypassing Cloudflare can forge it, so it is
 * only advisory; without Cloudflare, fall back to the right-most X-Forwarded-For hop.
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

/** Who is signing in from where: the request's origin plus the app that sent it. */
export type SignInSource = Partial<RequestOrigin> & { client?: string; userAgent?: string }

export function signInSource(header: (name: string) => string | undefined): SignInSource {
  const client = header('x-atlas-client')?.trim()
  const userAgent = header('User-Agent')?.trim()

  return {
    ...requestOrigin(header),
    ...(client ? { client } : {}),
    ...(userAgent ? { userAgent } : {}),
  }
}

/** Plain-text labels for emails; HTML callers must escape them. */
export function describeSignInSource(source: SignInSource): { device: string; place: string } {
  const place = [source.city, source.country].filter(Boolean).join(', ')

  return {
    device: source.client ?? source.userAgent?.slice(0, 120) ?? 'Unknown device',
    place: place || 'Unknown location',
  }
}
