import { expect, test } from 'bun:test'

import { config } from '@/config'

import { closeRedis, getRedis, withRedis } from './redis'

test('withRedis still fails open when the failure context cannot be read', async () => {
  const saved = { ...config.redis }

  config.redis.enabled = true
  config.redis.sentinels = ['127.0.0.1:1']
  try {
    const client = getRedis()

    ;(client as unknown as { commandQueue: undefined }).commandQueue = undefined

    expect(await withRedis(() => Promise.reject(new Error('boom')))).toBeNull()
    expect(
      await withRedis(() => {
        throw new Error('sync boom')
      }),
    ).toBeNull()
  } finally {
    getRedis().disconnect()
    await closeRedis()
    Object.assign(config.redis, saved)
  }
})
