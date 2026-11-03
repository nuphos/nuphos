import type { Context, MiddlewareHandler } from 'hono'

const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json\b/i
// RFC 9110 §8.8.3: an opaque-tag may contain commas, so match tags, not split.
const ENTITY_TAG = /(?:W\/)?"[^"]*"/g
const NO_STORE = /(?:^|,)\s*no-store\s*(?:,|$)/i

const opaque = (tag: string) => tag.replace(/^W\//, '')

/** The entity tags in an If-Match / If-None-Match value, or `'*'`. */
function parseTags(value: string): '*' | string[] {
  return value.trim() === '*' ? '*' : (value.match(ENTITY_TAG) ?? [])
}

/** A response this middleware may tag: one c.json() body, with no validator of its own. */
function taggable(res: Response): boolean {
  const h = res.headers

  if (res.status !== 200 || !res.body) return false
  if (h.has('etag') || h.has('last-modified') || h.has('content-encoding')) return false
  if (NO_STORE.test(h.get('cache-control') ?? '')) return false

  return JSON_TYPE.test(h.get('content-type') ?? '')
}

/** RFC 9110 §8.8.1: a collision-resistant hash of the data. Weak: gzip shares it. */
async function weakTag(res: Response): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer())

  return `W/"${Buffer.from(digest).toString('base64url')}"`
}

/** Body headers an empty 304 / 412 must not carry. CORS, request id and Vary stay. */
function isRepresentationHeader(name: string): boolean {
  return (
    (name.startsWith('content-') && name !== 'content-location') || name === 'transfer-encoding'
  )
}

function emptyResponse(c: Context, status: 304 | 412, tag: string): void {
  // Assigning c.res copies the old headers over; drop the body's own.
  c.res = new Response(null, { status })
  for (const name of [...c.res.headers.keys()]) {
    if (isRepresentationHeader(name)) c.res.headers.delete(name)
  }
  c.res.headers.set('ETag', tag)
}

/**
 * A weak ETag on 200 JSON GETs, with the RFC 9110 §13.2.2 preconditions
 * evaluated against it: If-Match first (412), then If-None-Match (304).
 * If-Unmodified-Since and If-Modified-Since need a Last-Modified this never
 * has, so §13.1.3 / §13.1.4 say to ignore them.
 *
 * Hono's `etag()` would hash every response, and an SSE stream never ends, so
 * it would never be sent. This only reads bodies `c.json()` already holds.
 */
export function jsonEtag(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    if (c.req.method !== 'GET' || !taggable(c.res)) return
    const tag = await weakTag(c.res)
    const ifMatch = c.req.header('If-Match')
    const ifNoneMatch = c.req.header('If-None-Match')

    // §13.1.1 compares strongly, and a weak tag never strongly matches.
    if (ifMatch !== undefined && parseTags(ifMatch) !== '*') return emptyResponse(c, 412, tag)
    if (ifNoneMatch !== undefined) {
      const tags = parseTags(ifNoneMatch)

      // §13.1.2 compares weakly.
      if (tags === '*' || tags.some((t) => opaque(t) === opaque(tag))) {
        return emptyResponse(c, 304, tag)
      }
    }
    c.res.headers.set('ETag', tag)
  }
}
