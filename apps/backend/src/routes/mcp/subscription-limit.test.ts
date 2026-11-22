import { beforeEach, expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'

const slots = new Map<string, string>()
let available = true
const redis = {
  eval: (script: string, _keys: number, key: string, token: string) => {
    if (script.includes("redis.call('SET'")) {
      if (slots.has(key)) return Promise.resolve(0)
      slots.set(key, token)

      return Promise.resolve(1)
    }
    if (slots.get(key) !== token) return Promise.resolve(0)
    slots.delete(key)

    return Promise.resolve(1)
  },
}

useRedis({
  redisEnabled: () => true,
  withRedis: (fn: (client: typeof redis) => Promise<unknown>) =>
    available ? fn(redis) : Promise.resolve(null),
} as never)
const { admitMcpSubscription, MCP_SUBSCRIPTION_LIMIT } = await import('./subscription-limit')

beforeEach(() => {
  slots.clear()
  available = true
})

test('concurrent claims share Redis slots and release only their own token', async () => {
  const results = await Promise.all(
    Array.from({ length: MCP_SUBSCRIPTION_LIMIT + 1 }, () => admitMcpSubscription('one')),
  )
  const acquired = results.filter((result) => typeof result === 'object')

  expect(acquired).toHaveLength(MCP_SUBSCRIPTION_LIMIT)
  expect(results.filter((result) => result === 'limited')).toHaveLength(1)
  const first = acquired[0]!

  await first.release()
  const replacement = await admitMcpSubscription('one')

  expect(typeof replacement).toBe('object')
  await first.release()
  expect(await admitMcpSubscription('one')).toBe('limited')
  const other = await admitMcpSubscription('two')

  expect(typeof other).toBe('object')
})

test('coordination failure does not silently admit a stream', async () => {
  available = false
  expect(await admitMcpSubscription('one')).toBe('unavailable')
})
