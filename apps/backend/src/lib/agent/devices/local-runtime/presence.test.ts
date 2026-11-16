import { describe, expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'

import { createRedisPresenceStore } from './presence'

const stored = new Map<string, string>()
const calls: string[][] = []
let stalled = false

useRedis({
  redisEnabled: () => true,
  withRedis: async (op) =>
    stalled
      ? null
      : op({
          mget: (keys: string[]) => {
            calls.push(keys)

            return Promise.resolve(keys.map((key) => stored.get(key) ?? null))
          },
        } as never),
})

const key = (deviceId: string) => `agent:device:runtime:presence:u1:${deviceId}`

describe('redis presence store', () => {
  test('reads issued together share one MGET', async () => {
    stalled = false
    calls.length = 0
    stored.set(key('d1'), JSON.stringify({ conn: 'c1', seenAt: 1 }))
    stored.set(key('d3'), JSON.stringify({ conn: 'c3', seenAt: 3 }))
    const store = createRedisPresenceStore()

    const read = await Promise.all(['d1', 'd2', 'd3'].map((d) => store.get('u1', d)))

    expect(read.map((p) => p?.conn ?? null)).toEqual(['c1', null, 'c3'])
    expect(calls).toEqual([[key('d1'), key('d2'), key('d3')]])

    // A later read is a new batch.
    expect((await store.get('u1', 'd1'))?.conn).toBe('c1')
    expect(calls).toHaveLength(2)
  })

  test('a timed-out batch reads as absent for every caller', async () => {
    stalled = true
    const store = createRedisPresenceStore()

    expect(await Promise.all([store.get('u1', 'd1'), store.get('u1', 'd3')])).toEqual([null, null])
  })
})
