import net from 'node:net'

import { describe, expect, test } from 'bun:test'
import Redis from 'ioredis'

import { callerFrame, trackRedisOp } from './redis-op-log'

/** A Redis that answers the handshake and never replies to anything else. */
async function stalledRedis(): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((socket) => {
    socket.on('error', () => {})
    socket.on('data', (data) => {
      for (const raw of data.toString().split(/(?=\*\d+\r\n)/)) {
        if (raw.toLowerCase().includes('\r\nclient\r\n')) socket.write('+OK\r\n')
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return { port: (server.address() as net.AddressInfo).port, close: () => server.close() }
}

describe('redis op log', () => {
  test('names the stalled commands without their keys or values', async () => {
    const server = await stalledRedis()
    const client = new Redis(server.port, '127.0.0.1', {
      lazyConnect: true,
      enableReadyCheck: false,
    })

    try {
      await client.connect()
      void client.get('earlier-key').catch(() => {})
      const tracked = trackRedisOp(client)

      void client
        .multi()
        .set('secret-key', 'secret-value')
        .set('other-key', 'other-value')
        .exec()
        .catch(() => {})
      tracked.sent()
      await new Promise((resolve) => setTimeout(resolve, 20))

      const fields = tracked.fields()

      expect(fields).toMatchObject({
        role: 'client',
        command: 'multi,set,exec',
        status: 'ready',
        in_flight: 5,
        head_command: 'get',
      })
      expect(fields.elapsed_ms).toBeGreaterThanOrEqual(15)
      expect(fields.caller).toContain('redis-op-log.test.ts:')
      expect(JSON.stringify(fields)).not.toMatch(/secret|other-|earlier-key/)
    } finally {
      client.disconnect()
      server.close()
    }
  })

  test('caller skips the wrapper frames and trims paths and columns', () => {
    const stack = [
      'Error',
      '    at trackRedisOp (/app/src/lib/redis-op-log.ts:34:19)',
      '    at withRedis (/app/src/lib/redis.ts:150:19)',
      '    at claimOwnership (/app/src/lib/agent/run-store/ownership.ts:120:10)',
      '    at /app/src/index.ts:1:1',
    ].join('\n')

    expect(callerFrame(stack)).toBe('claimOwnership (lib/agent/run-store/ownership.ts:120)')
    expect(callerFrame('Error\n    at /app/src/index.ts:7:3')).toBe('index.ts:7')
    expect(callerFrame(undefined)).toBeUndefined()
  })
})
