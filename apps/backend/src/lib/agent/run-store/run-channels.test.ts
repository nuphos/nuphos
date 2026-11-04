import { expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'

import type { real as realRedis } from '@/lib/test/doubles/redis'

const sets = new Map<string, Set<string>>()
const ttls = new Map<string, number>()
const fake = {
  pipeline() {
    const ops: (() => void)[] = []
    const chain = {
      sadd(key: string, ...members: string[]) {
        ops.push(() => {
          sets.set(key, new Set([...(sets.get(key) ?? []), ...members]))
        })

        return chain
      },
      expire(key: string, seconds: number) {
        ops.push(() => ttls.set(key, seconds))

        return chain
      },
      exec: async () => {
        for (const op of ops) op()
      },
    }

    return chain
  },
  smembers: async (key: string) => [...(sets.get(key) ?? [])],
}

useRedis({
  redisEnabled: () => true,
  withRedis: async (op) =>
    op(fake as unknown as Parameters<Parameters<typeof realRedis.withRedis>[0]>[0]),
})

const { addRunChannels, readRunChannels } = await import('./run-channels')

test('a turn keeps the channels that started it and those steered in, once each', async () => {
  await addRunChannels('owner', 'turn', ['channel-a'])
  await addRunChannels('owner', 'turn', ['channel-b'])
  await addRunChannels('owner', 'turn', ['channel-b'])
  // Another turn of the session is its own.
  await addRunChannels('owner', 'next-turn', ['channel-c'])

  expect(await readRunChannels('owner', 'turn')).toEqual(['channel-a', 'channel-b'])
  expect(await readRunChannels('owner', 'next-turn')).toEqual(['channel-c'])
  expect(await readRunChannels('owner', 'own-chat-turn')).toEqual([])
  // It lapses with the turn's stream.
  expect(ttls.get('atlas:agentrun:owner:turn:channels')).toBe(2 * 60 * 60)
})

test('a turn no channel started writes nothing', async () => {
  sets.clear()
  await addRunChannels('owner', 'own-chat-turn', [])
  expect(sets.size).toBe(0)
})
