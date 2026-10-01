// Keep this value in sync with ATLAS_ERROR_SENTINEL in electron/atlas.ts —
// the main/renderer split prevents a direct import.
const ATLAS_ERROR_SENTINEL = '__ATLAS_API_ERROR__'

export type AtlasError = {
  message: string
  code?: string
  details?: unknown
}

// Errors thrown by the atlas IPC `call()` helper encode `{message, code, details}`
// into Error.message under a sentinel prefix (custom Error fields don't survive
// the main→renderer hop). Recover the structured payload here.
//
// Electron's `ipcRenderer.invoke` wraps rejections with a prefix like
// `Error invoking remote method 'atlas:foo': Error: ...`, so the sentinel
// can be embedded mid-string — locate it with `indexOf`, not `startsWith`.
export function parseAtlasError(e: unknown): AtlasError {
  const raw = e instanceof Error ? e.message : String(e)
  const idx = raw.indexOf(ATLAS_ERROR_SENTINEL)

  if (idx === -1) return { message: raw }
  try {
    const parsed = JSON.parse(raw.slice(idx + ATLAS_ERROR_SENTINEL.length)) as AtlasError

    if (typeof parsed?.message === 'string') return parsed
  } catch {
    // fall through
  }

  return { message: raw }
}

// Transient network-layer failures: offline, DNS lookup failure, connection
// refused/reset/timeout, or a request that exceeded its `AbortSignal.timeout()`
// budget. The main-process `fetch` surfaces these as a raw `TypeError: fetch
// failed` or a `TimeoutError: The operation was aborted due to timeout` (no
// atlas sentinel), so they read as opaque errors. The failed request itself
// stays rejected and must be retried (nothing here auto-recovers it) — but the
// underlying condition clears once connectivity returns or the backend catches
// up. Toast gating no longer relies on this classifier (see decideErrorToast —
// toasts are whitelist-only); isNetworkError remains for retry/reconnect
// decisions that need to distinguish connectivity loss from a real failure.
// Whitelist gate for error toasts (consumed by toast.apiError). Only failures
// the backend deliberately produced — a structured {code, message} recovered
// from the atlas sentinel — surface to the user: their messages are authored
// by our own error handler, so they are always meaningful. Everything else
// (network/TLS failures, proxy bodies, IPC wrapper noise, unexpected
// exceptions) reads as garbage in a toast and is suppressed; toast.apiError
// reports those to PostHog instead so failure rates stay queryable.
//
// subscription_required used to be suppressed here, back when every product
// route emitted it and a new team would get one toast per eager on-mount
// loader. The console is free now, so the only thing that raises it is an
// agent turn the user deliberately started — swallowing that would leave the
// composer looking broken. It goes through the whitelist like any other
// backend-authored error.
export type ErrorToastDecision =
  { action: 'show'; description: string } | { action: 'suppress'; reason: 'unexpected_error' }

// Hono's router 404 — "Route GET /teams/abc/database-connections not found".
// The backend authored it, so it clears the whitelist, but it describes app ↔
// backend version skew, not anything the user did. Backends before the
// route_not_found code label it 'not_found', which real "Conversation not
// found" business errors also use, so those are matched by message shape.
const ROUTE_NOT_FOUND_MESSAGE = /^Route [A-Z]+ \S* not found$/

function isRouteNotFound(parsed: AtlasError): boolean {
  if (parsed.code === 'route_not_found') return true

  return parsed.code === 'not_found' && ROUTE_NOT_FOUND_MESSAGE.test(parsed.message)
}

export function decideErrorToast(e: unknown): ErrorToastDecision {
  const parsed = parseAtlasError(e)

  if (isRouteNotFound(parsed)) {
    return { action: 'suppress', reason: 'unexpected_error' }
  }
  if (parsed.code !== undefined) {
    return { action: 'show', description: parsed.message }
  }

  return { action: 'suppress', reason: 'unexpected_error' }
}

/** The backend refused the stored session itself (expired, revoked, or signed
 *  by another deployment); no retry can succeed, only signing in again. */
export function isSessionRejected(e: unknown): boolean {
  return parseAtlasError(e).code === 'unauthorized'
}

export function isNetworkError(e: unknown): boolean {
  const raw = (e instanceof Error ? e.message : String(e)).toLowerCase()

  return (
    raw.includes('fetch failed') ||
    raw.includes('failed to fetch') ||
    raw.includes('networkerror when attempting to fetch resource') ||
    raw.includes('enotfound') ||
    raw.includes('econnrefused') ||
    raw.includes('econnreset') ||
    raw.includes('etimedout') ||
    raw.includes('eai_again') ||
    raw.includes('getaddrinfo') ||
    raw.includes('operation was aborted') ||
    raw.includes('aborted due to timeout') ||
    raw.includes('timed out') ||
    // undici fetch throws "Connect Timeout Error" / "Headers Timeout Error" /
    // "Body Timeout Error" — none of which contain "timed out". Match the
    // "timeout error" phrase specifically rather than a bare "timeout" so
    // app-level timeouts (e.g. a "query timeout" from the backend) still toast.
    raw.includes('timeout error') ||
    // Node TLS: "Client network socket disconnected before secure TLS
    // connection was established" — carries no ECONN* code in the message.
    raw.includes('socket disconnected') ||
    raw.includes('socket hang up')
  )
}

/** Keep one Error Tracking issue per connectivity incident class while the
 * apiOperation property preserves which renderer calls were affected. */
export function apiErrorPhase(operation: string, error: unknown): string {
  return isNetworkError(error) ? 'network_failure' : operation
}
