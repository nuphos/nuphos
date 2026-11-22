import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'
import Redis from 'ioredis'

import { useRedis } from '@/lib/test/doubles/redis'

let client: Redis

useRedis({
  redisEnabled: () => true,
  withRedis: async (fn: (redis: Redis) => Promise<unknown>) => fn(client),
})
const { admitMcpSubscription, MCP_SUBSCRIPTION_LIMIT } = await import('./subscription-limit')

test.skipIf(!process.env.REDIS_SERVER_BIN)(
  'real Redis atomically bounds concurrent claims and protects replacement slots',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-subscriptions-'))
    const socket = join(dir, 'redis.sock')
    const server = spawn(
      process.env.REDIS_SERVER_BIN!,
      ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'],
      { stdio: 'ignore' },
    )

    client = new Redis(socket, { retryStrategy: () => 20, maxRetriesPerRequest: 20 })
    try {
      await client.ping()
      const results = await Promise.all(
        Array.from({ length: 20 }, () => admitMcpSubscription('same-user')),
      )
      const admitted = results.filter((result) => typeof result === 'object')

      expect(admitted).toHaveLength(MCP_SUBSCRIPTION_LIMIT)
      expect(results.filter((result) => result === 'limited')).toHaveLength(17)
      await admitted[0]!.release()
      const next = await admitMcpSubscription('same-user')

      expect(typeof next).toBe('object')
      await admitted[0]!.release()
      expect(await admitMcpSubscription('same-user')).toBe('limited')
      for (const slot of [...admitted, next]) if (typeof slot === 'object') await slot.release()
    } finally {
      client.disconnect()
      server.kill()
      await rm(dir, { recursive: true, force: true })
    }
  },
)
