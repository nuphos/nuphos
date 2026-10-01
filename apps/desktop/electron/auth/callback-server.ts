import type { Server } from 'node:http'

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
/** Backoff between retries of the code-for-session exchange. */
export const SESSION_POLL_INTERVAL_MS = 1_500
/** How often to check whether the browser has come back yet. */
export const CALLBACK_WAIT_INTERVAL_MS = 50

/** A request that arrived on our loopback listener, waiting for a response. */
export type CallbackHit = {
  params: URLSearchParams
  respond: (status: number, body: string, contentType?: string) => void
}

export function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()

      if (!addr || typeof addr !== 'object') {
        reject(new Error('Failed to bind callback server'))

        return
      }
      resolve(addr.port)
    })
  })
}

/**
 * The `state` check correlates the redirect with the attempt this process
 * started, so a stray local request cannot drive it.
 */
export function onCallback(
  server: Server,
  clientState: string,
  handler: (hit: CallbackHit) => void,
): void {
  server.on('request', (req, res) => {
    if (!req.url?.startsWith('/callback')) {
      res.writeHead(404)
      res.end()

      return
    }

    const url = new URL(req.url, 'http://127.0.0.1')

    if (url.searchParams.get('state') !== clientState) {
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('invalid request')

      return
    }

    let answered = false

    handler({
      params: url.searchParams,
      respond: (status, body, contentType = 'text/html; charset=utf-8') => {
        if (answered) return
        answered = true
        try {
          res.writeHead(status, { 'content-type': contentType, 'access-control-allow-origin': '*' })
          res.end(body)
        } catch {
          // already responded / socket gone
        }
      },
    })
  })
}
