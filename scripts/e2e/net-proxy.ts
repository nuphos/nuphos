// Repro only (not for merge): sits between the Desktop and the backend to make the
// network slow, or to drop the chat stream, the way a poor connection would.
import { createServer, request } from 'node:http'
import { connect } from 'node:net'

import type { IncomingMessage, ServerResponse } from 'node:http'

export type NetProxy = {
  url: string
  /** Delay before a response's headers, and before each chunk of its body. */
  slow: (headersMs: number, chunkMs: number) => void
  /** Ends the next `count` chat streams `afterMs` after their headers. */
  cutChat: (count: number, afterMs: number) => void
  /** Drops the next `count` chat requests once the backend has answered, before the headers reach the Desktop. */
  dropChatBeforeHeaders: (count: number) => void
  reset: () => void
  log: string[]
}

export async function startNetProxy(target: string): Promise<NetProxy> {
  const upstream = new URL(target)
  let headersMs = 0
  let chunkMs = 0
  let cuts = { count: 0, afterMs: 0 }
  let drops = 0
  const log: string[] = []
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const isChat = (req: IncomingMessage) => req.method === 'POST' && req.url?.startsWith('/agent/chat')

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const chat = isChat(req)
    const proxied = request(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (answer) => {
        void (async () => {
          if (chat && drops > 0) {
            drops--
            log.push(`drop-before-headers ${String(answer.statusCode)}`)
            answer.resume()
            res.socket?.destroy()

            return
          }
          if (headersMs) await wait(headersMs)
          res.writeHead(answer.statusCode ?? 502, answer.headers)
          res.flushHeaders()
          if (chat && cuts.count > 0) {
            cuts.count--
            const afterMs = cuts.afterMs

            log.push(`cut-chat after ${String(afterMs)}ms`)
            setTimeout(() => res.socket?.destroy(), afterMs)
          }
          let queue = Promise.resolve()

          answer.on('data', (chunk: Buffer) => {
            answer.pause()
            queue = queue.then(async () => {
              if (chunkMs) await wait(chunkMs)
              if (!res.destroyed) res.write(chunk)
              answer.resume()
            })
          })
          answer.on('end', () => void queue.then(() => res.end()))
          answer.on('error', () => res.destroy())
        })()
      },
    )

    proxied.on('error', () => res.destroy())
    req.pipe(proxied)
  }
  const server = createServer(handle)

  // WebSockets and other upgrades pass straight through.
  server.on('upgrade', (req, socket, head) => {
    const out = connect(Number(upstream.port), upstream.hostname, () => {
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`]

      for (let i = 0; i < req.rawHeaders.length; i += 2)
        lines.push(`${req.rawHeaders[i] ?? ''}: ${req.rawHeaders[i + 1] ?? ''}`)
      out.write(lines.join('\r\n') + '\r\n\r\n')
      out.write(head)
      out.pipe(socket)
      socket.pipe(out)
    })

    out.on('error', () => socket.destroy())
    socket.on('error', () => out.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${String(port)}`,
    slow: (h, c) => {
      headersMs = h
      chunkMs = c
    },
    cutChat: (count, afterMs) => {
      cuts = { count, afterMs }
    },
    dropChatBeforeHeaders: (count) => {
      drops = count
    },
    reset: () => {
      headersMs = 0
      chunkMs = 0
      cuts = { count: 0, afterMs: 0 }
      drops = 0
    },
    log,
  }
}
