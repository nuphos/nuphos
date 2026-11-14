import net from 'node:net'

import { describe, expect, test } from 'bun:test'
import Redis from 'ioredis'

import { config } from '@/config'

import { REDIS_SOCKET_TIMEOUT_MS, closeRedis, getRedis, withRedis } from './redis'
import { anyClientEnded, forceReconnect } from './redis-wedge'

type Mode = 'normal' | 'slow' | 'silent'

/**
 * One server playing both sentinel and master, slow enough to leave a
 * "connecting" window. `state.mode` makes the master answer data commands
 * late (`slow`) or never (`silent`, a half-open socket).
 */
async function fakeSentinel(): Promise<{
  port: number
  state: { mode: Mode }
  close: () => void
}> {
  let port = 0
  const state = { mode: 'normal' as Mode }
  const reply = (socket: net.Socket, text: string) => {
    if (state.mode === 'silent') return
    if (state.mode === 'slow') setTimeout(() => socket.writable && socket.write(text), 1_000)
    else socket.write(text)
  }
  const server = net.createServer((socket) => {
    socket.on('error', () => {})
    socket.on('data', (data) => {
      for (const raw of data.toString().split(/(?=\*\d+\r\n)/)) {
        const args = raw
          .split('\r\n')
          .filter((_, i) => i > 0 && i % 2 === 0)
          .map((arg) => arg.toLowerCase())

        if (args[0] === 'sentinel' && args[1] === 'get-master-addr-by-name') {
          const address = `*2\r\n$9\r\n127.0.0.1\r\n$${String(String(port).length)}\r\n${String(port)}\r\n`

          setTimeout(() => socket.writable && socket.write(address), 100)
        } else if (args[0] === 'sentinel') socket.write('*0\r\n')
        else if (args[0] === 'info') socket.write('$13\r\nrole:master\r\n\r\n')
        else if (args[0] === 'client') socket.write('+OK\r\n')
        else if (args[0] === 'ping') reply(socket, '+PONG\r\n')
        else reply(socket, '+OK\r\n')
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as net.AddressInfo).port

  return { port, state, close: () => server.close() }
}

async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('forceReconnect', () => {
  test('a second trip while the client is reconnecting does not end it', async () => {
    const sentinel = await fakeSentinel()
    const client = new Redis({
      sentinels: [{ host: '127.0.0.1', port: sentinel.port }],
      name: 'master',
      maxRetriesPerRequest: 1,
      retryStrategy: () => 10,
    })

    client.on('error', () => {})

    try {
      await until(() => client.status === 'ready')
      expect(forceReconnect(client)).toBe(true)
      await until(() => client.status === 'connecting')
      expect(forceReconnect(client)).toBe(false)
      await until(() => client.status === 'ready')
      expect(await client.ping()).toBe('PONG')
      expect(anyClientEnded([client, null])).toBe(false)
    } finally {
      client.disconnect()
      sentinel.close()
    }
  })
})

describe('anyClientEnded', () => {
  test('flags a client that a disconnect during reconnect ended for good', async () => {
    const sentinel = await fakeSentinel()
    const client = new Redis({
      sentinels: [{ host: '127.0.0.1', port: sentinel.port }],
      name: 'master',
      maxRetriesPerRequest: 1,
      retryStrategy: () => 10,
    })

    client.on('error', () => {})

    try {
      await until(() => client.status === 'ready')
      client.disconnect(true)
      await until(() => client.status === 'connecting')
      client.disconnect(true)
      await until(() => client.status === 'end')
      expect(anyClientEnded([null, client])).toBe(true)
    } finally {
      client.disconnect()
      sentinel.close()
    }
  })
})

describe('the shared client', () => {
  async function withSharedClient(
    run: (sentinel: Awaited<ReturnType<typeof fakeSentinel>>) => Promise<void>,
  ) {
    const sentinel = await fakeSentinel()
    const saved = { ...config.redis }

    config.redis.enabled = true
    config.redis.sentinels = [`127.0.0.1:${String(sentinel.port)}`]
    config.redis.masterName = 'master'
    try {
      await run(sentinel)
    } finally {
      getRedis().disconnect()
      await closeRedis()
      Object.assign(config.redis, saved)
      sentinel.close()
    }
  }

  test('slow replies time ops out without dropping the connection', async () => {
    await withSharedClient(async (sentinel) => {
      const client = getRedis()
      let closes = 0

      client.on('close', () => {
        closes += 1
      })
      await until(() => client.status === 'ready')
      sentinel.state.mode = 'slow'
      const results = await Promise.all(
        Array.from({ length: 20 }, () => withRedis((c) => c.get('k'))),
      )

      expect(results.every((result) => result === null)).toBe(true)
      // Let the late replies arrive; the socket keeps delivering bytes.
      await new Promise((resolve) => setTimeout(resolve, 1_200))
      expect(closes).toBe(0)
      expect(client.status).toBe('ready')
      sentinel.state.mode = 'normal'
      expect(await withRedis((c) => c.get('k'))).toBe('OK')
    })
  })

  test('a half-open socket is dropped and the client reconnects', async () => {
    await withSharedClient(async (sentinel) => {
      const client = getRedis()

      await until(() => client.status === 'ready')
      sentinel.state.mode = 'silent'
      const started = performance.now()

      expect(await withRedis((c) => c.get('k'))).toBeNull()
      await until(() => client.status !== 'ready')
      expect(performance.now() - started).toBeGreaterThanOrEqual(REDIS_SOCKET_TIMEOUT_MS - 50)
      sentinel.state.mode = 'normal'
      await until(() => client.status === 'ready')
      expect(await withRedis((c) => c.ping())).toBe('PONG')
    })
  }, 15_000)
})
