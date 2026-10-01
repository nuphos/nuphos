import { responseErrorCode } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import type { MiddlewareHandler } from 'hono'

export function requestLog(log: typeof logEvent = logEvent): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now()

    try {
      await next()
    } finally {
      const requestId: unknown = c.get('requestId')

      log('info', 'http.request', {
        request_id: typeof requestId === 'string' ? requestId : undefined,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        error_code: c.res.status >= 400 ? responseErrorCode(c) : undefined,
        duration_ms: Date.now() - startedAt,
        // e.g. "nuphos-desktop/0.15.0" — without it, "is this user's client too
        // old?" is unanswerable from logs (3c2e03db post-mortem blind spot).
        client_version: c.req.header('X-Atlas-Client') ?? undefined,
      })
    }
  }
}
