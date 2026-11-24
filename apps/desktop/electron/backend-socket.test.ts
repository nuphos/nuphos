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
const { dialBackend, routeBackendSocketsThroughSystemProxy } = await import('./backend-socket.ts')

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

  assert.deepEqual(failures, [
    { host: `127.0.0.1:${String(port)}`, code: 'ECONNREFUSED', $process_person_profile: false },
  ])
})

test('a server that answers without upgrading reports a rejected handshake', async () => {
  const server = createServer((_req, res) => res.writeHead(401).end()).listen(0, '127.0.0.1')

  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  failures.length = 0
  await dial(`http://127.0.0.1:${String(port)}/x`)
  server.close()

  assert.deepEqual(failures, [
    {
      host: `127.0.0.1:${String(port)}`,
      code: 'handshake_rejected',
      $process_person_profile: false,
    },
  ])
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

/** A session whose proxy config answers `rule` for every URL. */
function systemProxy(rule: string) {
  return { resolveProxy: async () => rule, forceReloadProxyConfig: async () => undefined }
}

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

  await routeBackendSocketsThroughSystemProxy(
    systemProxy(`PROXY 127.0.0.1:${String(proxyPort)}; DIRECT`),
    url,
  )
  const socket = dialBackend(url, { authorization: 'Bearer t' })

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  socket.close()
  await routeBackendSocketsThroughSystemProxy(systemProxy('DIRECT'), url)
  proxy.close()
  proxy.closeAllConnections()
  backend.close()

  assert.deepEqual(tunneled, [`127.0.0.1:${String(backend.port)}`])
})

test('a proxy lookup that never answers lets the runtime start anyway', async () => {
  const stuck = {
    resolveProxy: () => new Promise<string>(() => {}),
    forceReloadProxyConfig: () => new Promise<void>(() => {}),
  }
  const started = Date.now()

  await routeBackendSocketsThroughSystemProxy(stuck, 'http://127.0.0.1:1', 50)

  assert.ok(Date.now() - started < 1000)
})

/** An HTTP CONNECT proxy that records each target it tunnels to. */
async function connectProxy(): Promise<{ port: number; tunneled: string[]; close: () => void }> {
  const tunneled: string[] = []
  const proxy = createServer().on('connect', (req, client) => {
    tunneled.push(String(req.url))
    const [host = '', port = ''] = String(req.url).split(':')
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(client).pipe(upstream)
    })

    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
  })

  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', () => resolve(undefined)))

  return {
    port: (proxy.address() as AddressInfo).port,
    tunneled,
    close: () => {
      proxy.close()
      proxy.closeAllConnections()
    },
  }
}

/** Dials once and reports whether the socket opened. */
function dialOutcome(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dialBackend(url, { authorization: 'Bearer t' })

    socket.addEventListener('open', () => {
      socket.close()
      resolve(true)
    })
    socket.addEventListener('error', () => resolve(false))
  })
}

test('a dial that fails through one proxy tries the next proxy in the list', async () => {
  const backend = await upgradeServer()
  const dead = createServer().listen(0, '127.0.0.1')

  await new Promise((resolve) => dead.once('listening', resolve))
  const deadPort = (dead.address() as AddressInfo).port

  dead.close()
  const live = await connectProxy()
  const url = `http://127.0.0.1:${String(backend.port)}/agent/devices/d/runtime-tunnel`
  const rule = `PROXY 127.0.0.1:${String(deadPort)}; PROXY 127.0.0.1:${String(live.port)}`

  await routeBackendSocketsThroughSystemProxy(systemProxy(rule), url)
  const outcomes = [await dialOutcome(url), await dialOutcome(url), await dialOutcome(url)]

  await routeBackendSocketsThroughSystemProxy(systemProxy('DIRECT'), url)
  live.close()
  backend.close()

  assert.deepEqual(outcomes, [false, true, true])
  assert.deepEqual(live.tunneled, [
    `127.0.0.1:${String(backend.port)}`,
    `127.0.0.1:${String(backend.port)}`,
  ])
})
