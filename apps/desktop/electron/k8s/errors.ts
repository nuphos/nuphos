export function is401(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>

  if (e.statusCode === 401) return true
  if (
    typeof e.response === 'object' &&
    e.response &&
    (e.response as Record<string, unknown>).statusCode === 401
  )
    return true
  if (
    typeof e.response === 'object' &&
    e.response &&
    (e.response as Record<string, unknown>).status === 401
  )
    return true
  if (typeof e.message === 'string' && /\b401\b/.test(e.message)) return true

  return false
}

export function is404(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>

  if (e.statusCode === 404) return true
  if (
    typeof e.response === 'object' &&
    e.response &&
    (e.response as Record<string, unknown>).statusCode === 404
  )
    return true
  if (
    typeof e.response === 'object' &&
    e.response &&
    (e.response as Record<string, unknown>).status === 404
  )
    return true
  if (typeof e.message === 'string' && /\b404\b/.test(e.message)) return true

  return false
}

export function is403(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>

  if (e.statusCode === 403) return true
  if (
    typeof e.response === 'object' &&
    e.response &&
    (e.response as Record<string, unknown>).statusCode === 403
  )
    return true
  if (
    typeof e.response === 'object' &&
    e.response &&
    (e.response as Record<string, unknown>).status === 403
  )
    return true
  if (typeof e.message === 'string' && /\b403\b/.test(e.message)) return true

  return false
}

// A `previous: true` log read on a container that never terminated returns a
// 400 whose message is "previous terminated container ... not found". That's an
// expected empty result, not a failure — callers treat it as "no rows" so the
// renderer shows a clean empty state instead of regex-matching an error message
// (which loses fidelity once it crosses the IPC boundary).
export function isNoPreviousLog(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  const body = typeof e.body === 'object' && e.body ? (e.body as Record<string, unknown>) : null
  const msg = `${typeof e.message === 'string' ? e.message : ''} ${
    body && typeof body.message === 'string' ? body.message : ''
  }`

  return /previous terminated container .* not found/i.test(msg)
}

export function emptyListOnMissingOrForbidden<T>(err: unknown): { items: T[] } {
  if (!is404(err) && !is403(err)) throw err

  return { items: [] }
}

// Backstop deadline for every request the API clients issue.
//
// @kubernetes/client-node ships node-fetch v2, which applies NO timeout of its
// own — not on connect, not on headers. An endpoint that stops responding
// therefore leaves the promise pending forever: no error is ever thrown, so
// none of the retry/refresh logic below ever runs and the caller simply hangs.
//
// This is deliberately generous. Its only job is to break an infinite hang, NOT
// to decide how long a request may legitimately take: an unpaginated LIST on a
// large cluster is genuinely multi-minute (a real cluster with 6000 namespaces
// needs several minutes and ~10MB for `listPodForAllNamespaces`), and a tight
// budget here turns a slow-but-working view into a permanently failing one.
// Callers that must fail fast impose their own, shorter deadline — see the
// cluster-access gate.
export const REQUEST_TIMEOUT_MS = 300_000
// Metrics is best-effort enrichment on list paths (every caller already
// tolerates it failing), so it gets a tighter deadline than the real API calls.
export const METRICS_TIMEOUT_MS = 10_000

export class K8sTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `The Kubernetes API did not respond within ${String(Math.round(timeoutMs / 1000))}s — ` +
        `the cluster endpoint may be unreachable from this machine.`,
    )
    this.name = 'K8sTimeoutError'
  }
}

export class K8sUnauthorizedError extends Error {
  constructor() {
    super(
      'Kubernetes authentication failed (HTTP 401). The saved cluster credential was rejected ' +
        'or has expired. Reconnect this cluster with a fresh credential.',
    )
    this.name = 'K8sUnauthorizedError'
  }
}

// Retriable transport failures. We only treat as retriable the errors that
// prove the request never reached the API server — DNS resolution, TCP connect,
// and TLS handshake all complete *before* any HTTP bytes are sent. Because the
// server never saw the request, retrying is safe for any verb, including the
// non-idempotent mutations (create/delete/patch/scale) that also flow through
// withAuthRetry. A bare mid-stream ECONNRESET is deliberately NOT retried here:
// it could have landed after the server already applied a mutation, and
// re-running would double-apply. Read paths get an extra safety net from the
// renderer's silent-refresh retry instead.
//
// The reported Linode-gateway failure ("Client network socket disconnected
// before secure TLS connection was established") is exactly this pre-handshake
// class: the gateway dropped the connection during the TLS handshake.
export function isPreRequestConnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as {
    code?: unknown
    message?: unknown
    cause?: { code?: unknown; message?: unknown }
  }
  const code =
    typeof e.code === 'string' ? e.code : typeof e.cause?.code === 'string' ? e.cause.code : ''

  // DNS failure (ENOTFOUND/EAI_AGAIN) and refused connect (ECONNREFUSED) all
  // happen before the request is transmitted.
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED') return true
  const message =
    `${typeof e.message === 'string' ? e.message : ''} ${typeof e.cause?.message === 'string' ? e.cause.message : ''}`.toLowerCase()

  // Connection dropped during the TLS handshake (request not yet sent). Node
  // exposes no dedicated error *code* for this — the socket is reset
  // mid-handshake and surfaces as a generic ECONNRESET, which we deliberately
  // do NOT blanket-retry (it could land after a mutation was applied). So the
  // handshake message is the only signal that proves this reset happened before
  // any request was sent. We match the stable kernel of the phrase to ride out
  // minor wording changes; and the failure mode is safe — if a Node/Electron
  // upgrade ever rewrites it past recognition, we simply stop auto-retrying
  // this case (today's behaviour), and reads still self-heal via the renderer's
  // silent-refresh.
  return (
    message.includes('socket disconnected before') ||
    message.includes('before secure tls connection was established')
  )
}

// A deadline hit by `DeadlineHttpLibrary` surfaces as node-fetch's generic
// AbortError ("The user aborted a request") — useless to a user who aborted
// nothing. Translate it at the boundary so callers get an actionable message.
function isDeadlineAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: unknown; type?: unknown }

  return e.name === 'AbortError' || e.name === 'TimeoutError' || e.type === 'aborted'
}

/**
 * Turn a blown deadline into the actionable error, leaving anything else alone.
 *
 * Exported because not every failure reaches a caller through `withAuthRetry`:
 * the shared informer's initial LIST rejects inside `ListWatch`, which reports
 * it via an 'error' listener rather than by rejecting `start()`. Untranslated,
 * that surfaces as node-fetch's "The user aborted a request" — meaningless to a
 * user who aborted nothing, and it also fails the renderer's
 * unreachable-vs-forbidden classification.
 */
export function translateK8sError(err: unknown): unknown {
  if (is401(err)) return new K8sUnauthorizedError()

  return isDeadlineAbort(err) ? new K8sTimeoutError(REQUEST_TIMEOUT_MS) : err
}
