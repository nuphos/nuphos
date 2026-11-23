import { expect, test } from 'bun:test'

import { config } from '@/config'
import { runInTokenTeamScope, tokenTeamScope } from '@/lib/identity/token-team-scope'

import { closeRedis, getRedis, getSubscriber, withRedis } from './redis'

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

test('a client first used inside an agent-token request does not carry its team limit', async () => {
  const saved = { ...config.redis }

  config.redis.enabled = true
  config.redis.sentinels = ['127.0.0.1:1']

  try {
    // A replica's first tunnel or event stream may open inside a request limited to one team.
    const subscriber = runInTokenTeamScope('team-a', () => getSubscriber())
    // Every message the shared subscriber delivers, for every team, runs where its socket
    // reports; a failed connect reports there too.
    const seen = await new Promise<string | undefined>((resolve) => {
      subscriber.once('error', () => resolve(tokenTeamScope()))
    })

    expect(seen).toBeUndefined()
  } finally {
    getSubscriber().disconnect()
    await closeRedis()
    Object.assign(config.redis, saved)
  }
})
