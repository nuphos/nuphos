// A backend far away: a proxy in front of it that holds each request half a round trip, and
// each of its answer's bytes and socket frames the other half, set with `latency(min, max)`.
import { createServer, request } from 'node:http'
import { connect } from 'node:net'

import type { Duplex, Readable, Writable } from 'node:stream'

// The same delay for every chunk of one direction keeps its order.
const later = (ms: number, run: () => void) => (ms > 0 ? setTimeout(run, ms) : run())

export type Held = { at: number; ms: number; path: string }

export async function startLatencyProxy(target: string) {
  const { hostname, port } = new URL(target)
  let range: [number, number] = [0, 0]
  const held: Held[] = []
  let count = 0
  // Spread evenly over the range and the same every run: the golden ratio's fractional steps.
  const roundTrip = () => range[0] + ((count++ * 0.618_034) % 1) * (range[1] - range[0])
  const relay = (from: Readable, to: Writable, ms: number) => {
    from.on('data', (chunk: Buffer) => later(ms, () => to.write(chunk)))
    from.on('end', () => later(ms, () => to.end()))
    from.on('error', () => to.destroy())
  }

  const server = createServer((req, res) => {
    const ms = roundTrip()

    held.push({ at: Date.now(), ms, path: req.url ?? '' })
    const upstream = request(
      { hostname, port, path: req.url, method: req.method, headers: req.headers },
      (answer) => {
        later(ms / 2, () => res.writeHead(answer.statusCode ?? 502, answer.headers))
        relay(answer, res, ms / 2)
      },
    )

    upstream.on('error', () => res.destroy())
    later(ms / 2, () => relay(req, upstream, 0))
  })

  // WebSockets, as the backend socket: the upgrade and every frame both ways, as raw bytes.
  server.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    const ms = roundTrip()

    held.push({ at: Date.now(), ms, path: req.url ?? '' })
    const upstream = connect(Number(port), hostname, () => {
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`]

      for (let n = 0; n < req.rawHeaders.length; n += 2)
        lines.push(`${req.rawHeaders[n] ?? ''}: ${req.rawHeaders[n + 1] ?? ''}`)
      later(ms / 2, () => {
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
        if (head.length > 0) upstream.write(head)
        relay(socket, upstream, ms / 2)
      })
      relay(upstream, socket, ms / 2)
    })

    upstream.on('error', () => socket.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  if (!address || typeof address === 'string') throw new Error('The latency proxy has no port')

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    held,
    latency: (min: number, max = min) => {
      range = [min, max]
    },
    close: () => server.close(),
  }
}
