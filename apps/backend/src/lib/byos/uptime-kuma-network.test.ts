import http from 'node:http'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { safeAgentForUrl } from './uptime-kuma-network'

import type { AddressInfo } from 'node:net'

// The socket.io client only accepts an Agent, so the connect-time DNS check
// lives in the Agent's `lookup`. This pins the runtime to one that honors it.
describe('safeAgentForUrl', () => {
  let server: http.Server
  let port: number

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.end('reached')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => {
    server.close()
  })

  test('refuses to connect when the hostname resolves to loopback', async () => {
    const url = `http://localhost:${String(port)}/`
    const outcome = await new Promise<string>((resolve) => {
      const req = http.request(url, { agent: safeAgentForUrl(url) }, (res) => {
        res.resume()
        resolve('connected')
      })

      req.on('error', (err: NodeJS.ErrnoException) => {
        resolve(err.code ?? err.message)
      })
      req.end()
    })

    expect(outcome).toBe('EACCES')
  })
})
