import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import Redis from 'ioredis'

import { useRedis } from '@/lib/test/doubles/redis'

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'

// Every conversation list request (clients poll it, and a 304 still builds the
// body) reads its page's live runs, so its cost is counted in commands. A
// pipeline's commands count one by one, plus one `pipeline` per round trip.
// CI sets TEST_REDIS_URL.
const client = process.env.TEST_REDIS_URL ? new Redis(process.env.TEST_REDIS_URL) : null
const commands: string[] = []

function recording<T extends object>(target: T): T {
  const proxy: T = new Proxy(target, {
    get: (object, name) => {
      const value: unknown = Reflect.get(object, name)

      if (typeof name !== 'string' || typeof value !== 'function') return value

      return (...args: unknown[]) => {
        if (name !== 'exec') commands.push(name)
        const result: unknown = value.apply(object, args)

        if (name === 'pipeline' || name === 'multi') return recording(result as object)

        return result === object ? proxy : result
      }
    },
  })

  return proxy
}

const redis = client ? recording(client) : null

useRedis({
  redisEnabled: () => Boolean(client),
  withRedis: (async (op: (c: unknown) => unknown) => (redis ? op(redis) : null)) as never,
})

const { getActiveAgentRunsForSessions } = await import('./active-runs')
const { ACTIVE_RUN_TTL_SEC, ABANDONED_GUARD_GRACE_MS, activeRunKey } = await import('./shared')
const { channelsKey } = await import('./run-channels')

const USER = 'list-user'
const sessions = Array.from({ length: 20 }, (_, i) => ({ userId: USER, sessionId: `list-${i}` }))
// Sessions 0-4 have a live run; 0 and 1 answer channels.
const live = sessions.slice(0, 5)
const count = () =>
  commands.reduce<Record<string, number>>(
    (all, name) => ({ ...all, [name]: (all[name] ?? 0) + 1 }),
    {},
  )

afterAll(() => client?.disconnect())

describe.skipIf(!client)('live runs for a page of the conversation list', () => {
  beforeEach(async () => {
    const keys = sessions.map(({ sessionId }) => activeRunKey(USER, sessionId))

    await client!.del(...keys, ...live.map((_, i) => channelsKey(USER, `stream-${i}`)))
    for (const [i, { sessionId }] of live.entries()) {
      await client!.hset(activeRunKey(USER, sessionId), {
        streamId: `stream-${i}`,
        startedAt: '2026-11-16T00:00:00.000Z',
      })
      await client!.expire(activeRunKey(USER, sessionId), ACTIVE_RUN_TTL_SEC)
    }
    await client!.sadd(channelsKey(USER, 'stream-0'), 'channel-a')
    await client!.sadd(channelsKey(USER, 'stream-1'), 'channel-b', 'channel-c')
    commands.length = 0
  })

  test('a page of 20 is read in two round trips, whatever its live runs', async () => {
    const runs = (await getActiveAgentRunsForSessions(sessions)) as unknown as ({
      streamId: string
      channelIds?: string[]
    } | null)[]

    expect(runs.map((run) => run?.streamId ?? null)).toEqual([
      ...live.map((_, i) => `stream-${i}`),
      ...Array<null>(15).fill(null),
    ])
    expect(runs.slice(0, 2).map((run) => run?.channelIds?.sort())).toEqual([
      ['channel-a'],
      ['channel-b', 'channel-c'],
    ])
    // One pipeline of 20 run reads, one of 5 channel reads.
    expect(count()).toEqual({ pipeline: 2, hmget: 20, smembers: 5 })
  })

  test('the list leaves a dead run to the sweep instead of removing it per request', async () => {
    const key = activeRunKey(USER, 'list-0')

    // The owner's lease is gone (never written here) and the guard's TTL has decayed.
    await client!.pexpire(key, ACTIVE_RUN_TTL_SEC * 1_000 - ABANDONED_GUARD_GRACE_MS - 1_000)
    const [run] = await getActiveAgentRunsForSessions([sessions[0]!])

    expect(run?.streamId).toBe('stream-0')
    expect(await client!.exists(key)).toBe(1)
  })
})
