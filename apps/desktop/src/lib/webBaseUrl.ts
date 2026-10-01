// Renderer-side view of the Nuphos web origin. The value itself is resolved in
// the main process (electron/web-base-url.ts) from NUPHOS_WEB_URL and handed
// over the preload bridge, so a self-hosted deployment configures it at runtime
// instead of the client compiling nuphos.ai in.
//
// The fallback matters: unit tests and any non-Electron render have no bridge.

const DEFAULT_WEB_BASE_URL = 'https://nuphos.ai'

function resolve(): string {
  const fromBridge = (globalThis as { api?: { webBaseUrl?: string } }).api?.webBaseUrl

  return typeof fromBridge === 'string' && fromBridge ? fromBridge : DEFAULT_WEB_BASE_URL
}

export const WEB_BASE_URL = resolve()

/**
 * Is this an app page on our own web origin?
 *
 * Exact origin: host, because `docs.` and `api.` are different services rather
 * than app pages; scheme and port too, because a same-host `http://` URL is not
 * ours. A bare path resolves against the configured origin. Returns the parsed
 * URL so callers don't re-parse, or null.
 *
 * This is the single answer to a question that used to be asked four different
 * ways, with four different results — most consequentially in the chat link
 * handler, which matched any `*.nuphos.ai` host and so routed a docs link into
 * in-app navigation, landing on whatever app page shared the docs pathname.
 */
export function isAppWebUrl(value: string): URL | null {
  try {
    const url = new URL(value, WEB_BASE_URL)

    return url.origin === WEB_BASE_URL ? url : null
  } catch {
    return null
  }
}

/**
 * The web base URL under its historical name. Shareable row links (copy-link /
 * open-in-chat) are meant to be pasted into the agent or sent to a teammate, so
 * they must resolve in whichever web deployment this client is pointed at.
 *
 * Lives here rather than beside the copy-link menu it serves: a module that
 * exports both React components and plain constants defeats fast refresh.
 */
export const ATLAS_WEB_BASE_URL = WEB_BASE_URL

/** Join a relative path onto the web base URL. Pass-through if already absolute. */
export function toAbsoluteAtlasUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  if (!path) return WEB_BASE_URL
  const suffix = path.startsWith('/') ? path : `/${path}`

  return `${WEB_BASE_URL}${suffix}`
}
