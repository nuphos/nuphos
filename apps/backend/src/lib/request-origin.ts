import { isIP } from 'node:net'

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

  // Only an actual address: these headers can carry any text off Cloudflare.
  return candidates.map((value) => value?.trim()).find((value) => value && isIP(value) !== 0)
}

export type RequestOrigin = { ip: string; city?: string; country?: string }

const CITY = /^[\p{L}\p{M} .'-]{1,40}$/u
const COUNTRY = /^[A-Z]{2}$/

/** Where a request came from; city and country only when Cloudflare's visitor location headers are on. */
export function requestOrigin(
  header: (name: string) => string | undefined,
): RequestOrigin | undefined {
  const ip = clientIp(header('CF-Connecting-IP'), header('X-Forwarded-For'))

  if (!ip) return undefined
  // Cloudflare sends the city as UTF-8 bytes, but header values are read as latin1.
  const city = Buffer.from(header('CF-IPCity') ?? '', 'latin1')
    .toString('utf8')
    .trim()
  const country = header('CF-IPCountry')?.trim()

  // Shape-checked, since they end up in emails: a place name, an ISO code.
  return {
    ip,
    ...(city && CITY.test(city) ? { city } : {}),
    // XX: unknown; T1: Tor.
    ...(country && COUNTRY.test(country) && country !== 'XX' && country !== 'T1'
      ? { country }
      : {}),
  }
}

/** Who is signing in from where: the request's origin plus the app that sent it. */
export type SignInSource = Partial<RequestOrigin> & { client?: string; userAgent?: string }

/**
 * The IP and place come only from Cloudflare: behind it (hosted Nuphos only
 * accepts Cloudflare, via Authenticated Origin Pulls) CF-Connecting-IP is the
 * real client. X-Forwarded-For is whatever the caller sends, and the new
 * sign-in alert trusts this IP, so without Cloudflare the IP is unknown.
 */
export function signInSource(header: (name: string) => string | undefined): SignInSource {
  const client = header('x-atlas-client')?.trim()
  const userAgent = header('User-Agent')?.trim()

  return {
    ...(isIP(header('CF-Connecting-IP')?.trim() ?? '') !== 0 ? requestOrigin(header) : {}),
    ...(client ? { client } : {}),
    ...(userAgent ? { userAgent } : {}),
  }
}

// A Map, so a client like `constructor/1` cannot reach Object.prototype.
const APPS = new Map([
  ['nuphos-desktop', 'Nuphos Desktop'],
  ['nuphos-ios', 'Nuphos for iOS'],
  ['nuphos-android', 'Nuphos for Android'],
  ['nuphos-cli', 'Nuphos CLI'],
])
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

/**
 * A device name safe to put in an email. Both headers are whatever the caller
 * sends, so none of their text is echoed, not even an app's version: a known
 * app name, a browser and system picked from a fixed list, or "Unknown device".
 */
export function signInDevice(source: SignInSource): string {
  const app = APPS.get(source.client?.split('/')[0] ?? '')

  if (app) return app
  const ua = source.userAgent ?? ''
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1]
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1]

  if (browser && system) return `${browser} on ${system}`

  return browser ?? (system ? `A browser on ${system}` : 'Unknown device')
}

/** City and country as Cloudflare guessed them from the IP; only a hint. */
export function signInPlace(source: SignInSource): string | undefined {
  return [source.city, source.country].filter(Boolean).join(', ') || undefined
}
