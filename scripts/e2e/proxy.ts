// The proxies a VPN or proxy app sets up (#3354): HTTP (CONNECT and absolute-form), SOCKS5, PAC.
// Only they map the `.invalid` backend name, which never resolves, to the real port, so a
// connection that skips the proxy fails at DNS.
import { createServer, request } from 'node:http'
import { connect, createServer as createTcpServer } from 'node:net'

import type { AddressInfo, Server, Socket } from 'node:net'

export const PROXIED_HOST = 'nuphos-backend.e2e.invalid'

export type Proxies = {
  http: number
  socks: number
  /** Serves a PAC file that lists a dead proxy first, then the HTTP proxy. */
  pacUrl: string
  /** `host:port` of every connection each proxy opened to the backend. */
  tunnels: { http: string[]; socks: string[] }
  close: () => void
}

/** Where a proxied name really is: the `.invalid` name maps to this computer, nothing else does. */
function upstream(host: string): string | undefined {
  return host === PROXIED_HOST ? '127.0.0.1' : undefined
}

function pipe(client: Socket, host: string, port: number, onOpen: () => void): void {
  const target = upstream(host)

  if (!target) {
    client.destroy()

    return
  }
  const server = connect(port, target, () => {
    onOpen()
    server.pipe(client).pipe(server)
  })

  server.on('error', () => client.destroy())
  client.on('error', () => server.destroy())
}

async function listen(server: Server): Promise<number> {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))

  return (server.address() as AddressInfo).port
}

export async function startProxies(): Promise<Proxies> {
  const tunnels = { http: [] as string[], socks: [] as string[] }
  const sockets = new Set<Socket>()
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  }

  // CONNECT for the tunnel and the window's WebSockets; absolute-form for the window's requests.
  const http = createServer((req, res) => {
    const url = new URL(String(req.url))
    const target = upstream(url.hostname)

    if (!target) return void res.writeHead(502).end()
    const forwarded = request(
      {
        host: target,
        port: url.port,
        method: req.method,
        path: url.pathname + url.search,
        headers: req.headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      },
    )

    forwarded.on('error', () => res.destroy())
    req.pipe(forwarded)
  })

  http.on('connection', track)
  http.on('connect', (req, client: Socket) => {
    const [host = '', port = ''] = String(req.url).split(':')

    pipe(client, host, Number(port), () => {
      tunnels.http.push(String(req.url))
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    })
  })

  // SOCKS5 without authentication, CONNECT only (RFC 1928).
  const socks = createTcpServer((client) => {
    track(client)
    client.once('data', () => {
      client.write(Buffer.from([5, 0]))
      client.once('data', (ask: Buffer) => {
        const type = ask[3]
        let host = ''
        let at = 4

        if (type === 3) {
          const length = ask[4] ?? 0

          host = ask.subarray(5, 5 + length).toString()
          at = 5 + length
        } else if (type === 1) {
          host = [...ask.subarray(4, 8)].join('.')
          at = 8
        }
        const port = ask.readUInt16BE(at)
        const reply = (code: number) => client.write(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]))

        // A name the client resolved itself is not ours to map: it skipped the proxy for DNS.
        if (!upstream(host)) {
          reply(4)
          client.destroy()

          return
        }
        pipe(client, host, port, () => {
          tunnels.socks.push(`${host}:${String(port)}`)
          reply(0)
        })
      })
    })
  })

  const httpPort = await listen(http)
  const socksPort = await listen(socks)
  // A port nothing listens on, closed again before the PAC file names it.
  const closed = createTcpServer()
  const dead = await listen(closed)

  closed.close()
  const pac = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ns-proxy-autoconfig' })
    res.end(
      `function FindProxyForURL(url, host) { return "PROXY 127.0.0.1:${String(dead)}; PROXY 127.0.0.1:${String(httpPort)}"; }`,
    )
  })
  const pacPort = await listen(pac)

  return {
    http: httpPort,
    socks: socksPort,
    pacUrl: `http://127.0.0.1:${String(pacPort)}/proxy.pac`,
    tunnels,
    close: () => {
      for (const socket of sockets) socket.destroy()
      http.close()
      socks.close()
      pac.close()
    },
  }
}
