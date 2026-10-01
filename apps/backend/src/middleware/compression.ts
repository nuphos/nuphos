import { compress } from 'hono/compress'

import type { MiddlewareHandler } from 'hono'

/**
 * gzip/deflate for JSON and text responses when the client asks for it.
 * Transcript and tool-output JSON shrinks 5–10×; a 100-message conversation
 * tail is ~1.7 MB uncompressed.
 *
 * The agent chat SSE is never touched: Hono's compressible-type check
 * excludes `text/event-stream`, and the stream also carries
 * `Cache-Control: no-transform`, which the middleware honours. Responses
 * that already set `Content-Encoding` or `Transfer-Encoding` pass through
 * unchanged.
 *
 * `Vary: Accept-Encoding` goes on every response so a cache in front of the
 * API can never hand a gzipped body to a client that did not accept it.
 * Nothing caches today; the header costs nothing and removes the trap.
 */
export function responseCompression(): MiddlewareHandler {
  const gzip = compress()

  return async (c, next) => {
    await gzip(c, next)
    c.res.headers.append('Vary', 'Accept-Encoding')
  }
}
