import net from 'node:net'

import { describe, expect, test } from 'bun:test'
import Redis from 'ioredis'

import { REDIS_OP_TIMEOUT_MESSAGE, createRedisWedgeDetector, forceReconnect } from './redis-wedge'

const timeout = () => new Error(REDIS_OP_TIMEOUT_MESSAGE)

describe('redis wedge detector', () => {
  test('fires once after the threshold of consecutive timeouts', () => {
    let wedges = 0
    const detector = createRedisWedgeDetector(() => {
      wedges += 1
    }, 3)

    detector.failure(timeout())
    detector.failure(timeout())
    expect(wedges).toBe(0)
    detector.failure(timeout())
    expect(wedges).toBe(1)
    detector.failure(timeout())
    detector.failure(timeout())
    expect(wedges).toBe(1)
    detector.failure(timeout())
    expect(wedges).toBe(2)
  })

  test('a success or a non-timeout error resets the streak', () => {
    let wedges = 0
    const detector = createRedisWedgeDetector(() => {
      wedges += 1
    }, 3)

    detector.failure(timeout())
    detector.failure(timeout())
    detector.success()
    detector.failure(timeout())
    detector.failure(timeout())
    detector.failure(new Error('ECONNRESET'))
    detector.failure(timeout())
    detector.failure(timeout())
    expect(wedges).toBe(0)
  })
})

/** One server playing both sentinel and master, slow enough to leave a "connecting" window. */
async function fakeSentinel(): Promise<{ port: number; close: () => void }> {
  let port = 0
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
        else if (args[0] === 'ping') socket.write('+PONG\r\n')
        else socket.write('+OK\r\n')
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as net.AddressInfo).port

  return { port, close: () => server.close() }
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
    } finally {
      client.disconnect()
      sentinel.close()
    }
  })
})
