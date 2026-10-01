// The Nuphos web origin the desktop app treats as "ours".
//
// It decides three things that must agree: which links render as in-app
// mentions, which open in the app instead of a browser, and which a
// `nuphos://open` deep link is allowed to carry. Before this module each of
// those spelled the host out itself, and they disagreed — see isAppWebUrl.
//
// Runtime configuration, not build-time: a self-hosted deployment sets
// NUPHOS_WEB_URL the same way it already sets NUPHOS_API_URL, and the renderer
// reads the resolved value over the preload bridge rather than compiling its
// own copy in.

const DEFAULT_WEB_BASE_URL = 'https://nuphos.ai'

function normalize(raw: string | undefined): string {
  const trimmed = raw?.trim()

  if (!trimmed) return DEFAULT_WEB_BASE_URL
  try {
    // Keep the origin only: a base URL with a path would make every
    // `new URL(path, base)` resolve relative to it.
    return new URL(trimmed).origin
  } catch {
    return DEFAULT_WEB_BASE_URL
  }
}

export const WEB_BASE_URL = normalize(process.env.NUPHOS_WEB_URL)

const WEB_BASE_HOST = new URL(WEB_BASE_URL).hostname

/**
 * Hosts a `nuphos://open?url=` payload may carry. Wider than {@link isAppWebUrl}
 * on purpose: this is the main-process allowlist for a URL arriving from
 * outside the app, and links in the wild still use the www/app aliases.
 */
const BARE_HOST = WEB_BASE_HOST.replace(/^www\./, '')

export const ALLOWED_WEB_HOSTS: ReadonlySet<string> = new Set([
  WEB_BASE_HOST,
  `www.${BARE_HOST}`,
  `app.${BARE_HOST}`,
])

/**
 * Is this an app page on our own web origin?
 *
 * Exact origin, deliberately. Host, because `docs.` and `api.` are different
 * services rather than app pages; scheme and port too, because a same-host
 * `http://` URL is not ours — trusting it would let a downgraded link render as
 * a trusted app mention. Accepts a bare path, which resolves against the
 * configured origin.
 *
 * Returns the parsed URL so callers don't re-parse, or null.
 */
export function isAppWebUrl(value: string): URL | null {
  try {
    const url = new URL(value, WEB_BASE_URL)

    return url.origin === WEB_BASE_URL ? url : null
  } catch {
    return null
  }
}
