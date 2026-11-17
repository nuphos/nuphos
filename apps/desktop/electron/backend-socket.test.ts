import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { mock, test } from 'node:test'

import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

const failures: unknown[] = []

mock.module('./analytics.ts', {
  namedExports: { captureMain: (_event: string, failure: unknown) => failures.push(failure) },
})
const { dialBackend, refreshBackendProxy, routeBackendSocketsThroughSystemProxy } =
  await import('./backend-socket.ts')

/** Dials and waits for the failure, which dialBackend has already handled. */
function dial(url: string): Promise<void> {
  return new Promise((resolve) => {
    dialBackend(url, { authorization: 'Bearer t' }).addEventListener('error', () => resolve())
  })
}

test('a refused dial reports the host and the network error code, once per failure', async () => {
  const server = createServer().listen(0, '127.0.0.1')

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  server.close()
  failures.length = 0

  await dial(`http://127.0.0.1:${String(port)}/agent/devices/d/runtime-tunnel`)
  await dial(`http://127.0.0.1:${String(port)}/agent/devices/d/runtime-tunnel`)

  assert.deepEqual(failures, [{ host: `127.0.0.1:${String(port)}`, code: 'ECONNREFUSED' }])
})

test('a server that answers without upgrading reports a rejected handshake', async () => {
  const server = createServer((_req, res) => res.writeHead(401).end()).listen(0, '127.0.0.1')

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  failures.length = 0
  await dial(`http://127.0.0.1:${String(port)}/x`)
  server.close()

  assert.deepEqual(failures, [{ host: `127.0.0.1:${String(port)}`, code: 'handshake_rejected' }])
})

test('a refused dial tells its caller the status the server answered with', async () => {
  const server = createServer((_req, res) => res.writeHead(404).end()).listen(0, '127.0.0.1')

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  const statuses: number[] = []

  await new Promise<void>((resolve) => {
    dialBackend(
      `http://127.0.0.1:${String(port)}/agent/devices/d/runtime-tunnel?reclaim=1`,
      { authorization: 'Bearer t' },
      (status) => statuses.push(status),
    ).addEventListener('error', () => resolve())
  })
  server.close()

  assert.deepEqual(statuses, [404])
})

/** A WebSocket server that only accepts the upgrade, enough for a dial to open. */
async function upgradeServer(): Promise<{ port: number; close: () => void }> {
  const server = createServer()
  const upgraded: Duplex[] = []

  server.on('upgrade', (req, socket) => {
    upgraded.push(socket)
    // SHA-1 is what RFC 6455 requires for the handshake; nothing here is secret.
    // eslint-disable-next-line sonarjs/hashing
    const accept = createHash('sha1')
      .update(`${String(req.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')

    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))

  return {
    port: (server.address() as AddressInfo).port,
    close: () => {
      for (const socket of upgraded) socket.destroy()
      server.close()
    },
  }
}

test('a dial goes through the proxy the system gives for the backend', async () => {
  const backend = await upgradeServer()
  const tunneled: string[] = []
  const proxy = createServer().on('connect', (req, client) => {
    tunneled.push(String(req.url))
    const [host = '', port = ''] = String(req.url).split(':')
    const upstream = connect(Number(port), host, () => {
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(client).pipe(upstream)
    })
  })

  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', () => resolve(undefined)))
  const proxyPort = (proxy.address() as AddressInfo).port
  const url = `http://127.0.0.1:${String(backend.port)}/agent/devices/d/runtime-tunnel`

  routeBackendSocketsThroughSystemProxy(async () => `PROXY 127.0.0.1:${String(proxyPort)}; DIRECT`)
  await refreshBackendProxy(url)
  const socket = dialBackend(url, { authorization: 'Bearer t' })

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  socket.close()
  routeBackendSocketsThroughSystemProxy(async () => 'DIRECT')
  await refreshBackendProxy(url)
  proxy.close()
  proxy.closeAllConnections()
  backend.close()

  assert.deepEqual(tunneled, [`127.0.0.1:${String(backend.port)}`])
})
