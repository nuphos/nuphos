import net from 'node:net'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { MongoClient } from 'mongodb'
import { SocksClient } from 'socks'

import { config } from '@/config'

import { acceptClient, connectPublic, publicSocksProxy } from './public-socks'

import type { AddressInfo } from 'node:net'

let server: net.Server
let port: number
let accepted = 0

beforeAll(async () => {
  server = net.createServer((socket) => {
    accepted += 1
    socket.pipe(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(() => {
  server.close()
})

async function dial(host: string, password?: string) {
  const proxy = await publicSocksProxy()

  return await SocksClient.createConnection({
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: 5,
      userId: proxy.username,
      password: password ?? proxy.password,
    },
    command: 'connect',
    destination: { host, port },
    timeout: 2_000,
  })
}

describe('publicSocksProxy', () => {
  test.each(['127.0.0.1', 'localhost', '::1'])('never dials %s', async (host) => {
    const before = accepted

    await expect(dial(host)).rejects.toThrow()
    expect(accepted).toBe(before)
  })

  test('refuses a client without the credentials', async () => {
    const before = accepted

    await expect(dial('127.0.0.1', 'wrong')).rejects.toThrow()
    expect(accepted).toBe(before)
  })

  test('relays to an allowed destination', async () => {
    config.byos.outbound.allowPrivateHosts = true
    try {
      const { socket } = await dial('127.0.0.1')
      const echoed = new Promise<string>((resolve) =>
        socket.once('data', (d) => resolve(String(d))),
      )

      socket.write('ping')
      expect(await echoed).toBe('ping')
      socket.destroy()
    } finally {
      config.byos.outbound.allowPrivateHosts = false
    }
  })

  test('a MongoDB client pointed at a private literal never reaches it', async () => {
    const proxy = await publicSocksProxy()
    const before = accepted
    const client = new MongoClient(`mongodb://127.0.0.1:${String(port)}/?directConnection=true`, {
      proxyHost: proxy.host,
      proxyPort: proxy.port,
      proxyUsername: proxy.username,
      proxyPassword: proxy.password,
      serverSelectionTimeoutMS: 1_000,
    })

    await expect(client.connect()).rejects.toThrow()
    await client.close()
    expect(accepted).toBe(before)
  })

  test('connectPublic dials the address it checked, without resolving again', async () => {
    let lookups = 0
    const lookup = async () => {
      lookups += 1

      return [{ address: '127.0.0.1', family: 4 }]
    }

    config.byos.outbound.allowPrivateHosts = true
    try {
      const socket = await connectPublic('rebind.invalid', port, lookup)

      await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject))
      expect(socket.remoteAddress).toBe('127.0.0.1')
      expect((socket as { host?: string }).host).toBe('rebind.invalid')
      socket.destroy()
    } finally {
      config.byos.outbound.allowPrivateHosts = false
    }
    expect(lookups).toBe(1)
  })

  test('a socket error during the handshake is handled, not thrown', () => {
    const client = new net.Socket()

    acceptClient(client, 'user', 'pass')
    expect(() => client.emit('error', new Error('read ECONNRESET'))).not.toThrow()
  })

  test('a client gone while the dial completes leaves no upstream connection open', async () => {
    const proxy = await publicSocksProxy()
    const upstreams: net.Socket[] = []
    const target = net.createServer((socket) => upstreams.push(socket))

    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    const targetPort = (target.address() as AddressInfo).port
    const user = Buffer.from(proxy.username)
    const pass = Buffer.from(proxy.password)

    config.byos.outbound.allowPrivateHosts = true
    try {
      const client = net.connect(proxy.port, proxy.host)

      await new Promise((resolve) => client.once('connect', resolve))
      client.write(Buffer.from([5, 1, 2]))
      client.write(
        Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]),
      )
      client.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, targetPort >> 8, targetPort & 0xff]))
      client.destroy()
      await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
      config.byos.outbound.allowPrivateHosts = false
      target.close()
    }
    expect(upstreams.every((socket) => socket.destroyed || socket.readyState === 'closed')).toBe(
      true,
    )
  })
})
