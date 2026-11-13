import { expect, test } from 'bun:test'

import { config } from '@/config'

import { closeRedis, getRedis, withRedis } from './redis'

test('withRedis still fails open when the failure context cannot be read', async () => {
  const saved = { ...config.redis }

  config.redis.enabled = true
  config.redis.sentinels = ['127.0.0.1:1']
  const client = getRedis() as unknown as { commandQueue: unknown }
  const queue = client.commandQueue

  try {
    client.commandQueue = undefined
    expect(await withRedis(() => Promise.reject(new Error('boom')))).toBeNull()
    expect(
      await withRedis(() => {
        throw new Error('sync boom')
      }),
    ).toBeNull()
  } finally {
    // ioredis itself reads the queue while it disconnects.
    client.commandQueue = queue
    getRedis().disconnect()
    await closeRedis()
    Object.assign(config.redis, saved)
  }
})
