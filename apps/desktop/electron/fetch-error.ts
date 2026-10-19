import { randomUUID } from 'node:crypto'

import { captureMain } from './analytics.ts'

type ErrorLike = {
  name?: unknown
  message?: unknown
  code?: unknown
  syscall?: unknown
  cause?: unknown
  errors?: unknown
  socket?: unknown
}

type SocketInfo = {
  localAddress?: unknown
  localPort?: unknown
  remoteAddress?: unknown
  remotePort?: unknown
  bytesWritten?: unknown
  bytesRead?: unknown
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function endpoint(address: unknown, port: unknown): string | undefined {
  if (typeof address !== 'string' || !address) return undefined

  return typeof port === 'number' ? `${address}:${String(port)}` : address
}

function describeSocket(socket: unknown): string | undefined {
  if (!socket || typeof socket !== 'object') return undefined
  const s = socket as SocketInfo
  const local = endpoint(s.localAddress, s.localPort)
  const remote = endpoint(s.remoteAddress, s.remotePort)
  const parts = [
    local && `local=${local}`,
    remote && `remote=${remote}`,
    typeof s.bytesWritten === 'number' && `written=${String(s.bytesWritten)}`,
    typeof s.bytesRead === 'number' && `read=${String(s.bytesRead)}`,
  ].filter(Boolean)

  return parts.length ? parts.join(' ') : undefined
}

function describeCause(cause: unknown, depth: number): string | undefined {
  if (!cause || typeof cause !== 'object' || depth > 3) return text(cause)
  const e = cause as ErrorLike
  const code = text(e.code)
  const message = text(e.message)
  const name = text(e.name)
  const fallback = message ?? code ?? (name === 'Error' ? undefined : name)
  const head = code && message && !message.includes(code) ? `${code}: ${message}` : fallback
  // Happy-eyeballs connects throw an AggregateError with an empty message.
  const children = Array.isArray(e.errors)
    ? e.errors.map((child) => describeCause(child, depth + 1)).filter(Boolean)
    : []
  const nested = describeCause(e.cause, depth + 1)
  const parts = [
    head,
    children.length ? `[${children.join('; ')}]` : undefined,
    describeSocket(e.socket),
    nested && nested !== head ? `<- ${nested}` : undefined,
  ].filter(Boolean)

  return parts.length ? parts.join(' ') : undefined
}

/** undici's "fetch failed" with the cause it hides (code, sub-errors, socket). For logs only. */
export function describeFetchError(error: unknown): string {
  const message = text((error as ErrorLike | undefined)?.message) ?? String(error)
  const cause = describeCause((error as ErrorLike | undefined)?.cause, 0)

  return cause ? `${message} (${cause})` : message
}

// One line a person can read: no addresses, ports or byte counts. A system
// error reads as its syscall and code ("connect ECONNREFUSED"), since its
// message carries the address; undici's own messages lose their trailing
// "(attempted addresses: …)".
function reason(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return text(error)
  const e = error as ErrorLike
  const code = text(e.code)
  const syscall = text(e.syscall)

  if (syscall && code) return `${syscall} ${code}`
  const message = text(text(e.message)?.split(' (')[0])
  const child = Array.isArray(e.errors) ? reason(e.errors[0]) : undefined

  return message ?? child ?? code
}

/** Tag a backend request with the X-Request-Id the backend's requestId() adopts. */
export function tagRequest(headers: Record<string, string>): string {
  const requestId = randomUUID()

  headers['x-request-id'] = requestId

  return requestId
}

/**
 * A backend request that never got a response. The full cause goes to the log
 * under the request id; the error, which is all IPC keeps, carries only the
 * reason and the id. Aborts pass through so cancel handling still sees them.
 */
export function backendFailure(error: unknown, route: string, requestId: string): unknown {
  if (error instanceof Error && error.name === 'AbortError') return error
  const detail = describeFetchError(error)

  console.warn(`[backend] ${route} failed request_id=${requestId}: ${detail}`)
  captureMain('backend_request_failed', { request_id: requestId, route, error: detail })
  const why = reason((error as ErrorLike | undefined)?.cause) ?? reason(error) ?? 'unknown error'

  return new Error(`Nuphos backend request failed: ${why} (trace ${requestId.slice(0, 8)}…)`, {
    cause: error,
  })
}
