import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mock, test } from 'node:test'

import type { AddressInfo } from 'node:net'

const failures: unknown[] = []

mock.module('./analytics.ts', {
  namedExports: { captureMain: (_event: string, failure: unknown) => failures.push(failure) },
})
const { dialBackend } = await import('./backend-socket.ts')

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
