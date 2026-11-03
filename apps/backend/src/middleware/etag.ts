import type { MiddlewareHandler } from 'hono'

const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json\b/i

const stripWeak = (tag: string) => tag.trim().replace(/^W\//, '')

function matches(tag: string, ifNoneMatch: string): boolean {
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || stripWeak(t) === stripWeak(tag))
}

/** Body headers a 304 must not carry. Everything else (CORS, request id, Vary) stays. */
function isRepresentationHeader(name: string): boolean {
  return (
    (name.startsWith('content-') && name !== 'content-location') || name === 'transfer-encoding'
  )
}

async function weakTag(res: Response): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', await res.clone().arrayBuffer())

  return `W/"${Buffer.from(digest).toString('base64url')}"`
}

/**
 * A weak ETag on 200 JSON GETs, and `304 Not Modified` when `If-None-Match`
 * matches, so a polled list that has not changed costs no body on the wire.
 *
 * Hono's `etag()` would hash every response, and an SSE stream never ends, so
 * it would never be sent. This only reads bodies `c.json()` already holds.
 * Handlers that set their own `ETag` keep full control of it.
 */
export function jsonEtag(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    if (c.req.method !== 'GET') return
    const res = c.res

    if (res.status !== 200 || !res.body) return
    if (res.headers.has('etag') || res.headers.has('content-encoding')) return
    if (!JSON_TYPE.test(res.headers.get('content-type') ?? '')) return
    const tag = await weakTag(res)
    const ifNoneMatch = c.req.header('If-None-Match')

    if (!ifNoneMatch || !matches(tag, ifNoneMatch)) {
      res.headers.set('ETag', tag)

      return
    }
    // Assigning c.res copies the old headers over; drop the body's own.
    c.res = new Response(null, { status: 304 })
    for (const name of [...c.res.headers.keys()]) {
      if (isRepresentationHeader(name)) c.res.headers.delete(name)
    }
    c.res.headers.set('ETag', tag)
  }
}
