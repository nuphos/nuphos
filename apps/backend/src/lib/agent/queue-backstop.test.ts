import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import Redis from 'ioredis'

import { useRedis } from '@/lib/test/doubles/redis'

import type { PendingUserMessage } from './pending-message-types'

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'

// Every replica runs the queue backstop every 2 s on the shared Redis client, so
// its cost is counted in commands per tick. A pipeline's commands count one by
// one, plus one `pipeline` per round trip. SET NX and pipelines need a real
// Redis; CI sets TEST_REDIS_URL.
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
  // The real claimRun, on the recorded client.
  claimRun: async (key: string, ttlMs: number) =>
    (await redis?.set(key, 'test-replica', 'PX', ttlMs, 'NX')) === 'OK',
})

const { buildPendingUserMessage, localQueues, pendingKey, QUEUED_SESSIONS_KEY } =
  await import('./pending-messages')
const { installQueuedTurnStarter, sweepQueuedSessions } = await import('./session-released')

const OWNER = 'backstop-owner'
const CLAIM = 'atlas:agentrun-pending-sweep'
const flush = () => new Promise((resolve) => setTimeout(resolve, 30))
const started: string[] = []
const count = () =>
  commands.reduce<Record<string, number>>(
    (all, name) => ({ ...all, [name]: (all[name] ?? 0) + 1 }),
    {},
  )

// A person's send, which a turn starts; a teammate's old steering message, which only
// that teammate's own turn may answer, so nothing starts for it.
const waiting = (text: string): PendingUserMessage => ({
  ...buildPendingUserMessage({ renderedText: text, source: 'app', actorUserId: OWNER }),
  chat: {
    streamId: `stream-${text}`,
    message: { id: `ui-${text}`, role: 'user', parts: [{ type: 'text', text }] },
    locale: 'en',
    localTools: true,
  },
})
const parked = (text: string) =>
  buildPendingUserMessage({ renderedText: text, source: 'app', actorUserId: 'teammate' })

async function seed(sessionId: string, message?: object) {
  await client!.sadd(QUEUED_SESSIONS_KEY, `${OWNER}:${sessionId}`)
  if (message) await client!.rpush(pendingKey(OWNER, sessionId), JSON.stringify(message))
}

afterAll(() => client?.disconnect())

describe.skipIf(!client)('queue backstop cost per tick', () => {
  const parkedSessions = Array.from({ length: 10 }, (_, i) => `backstop-parked-${i}`)
  const all = ['backstop-waiting', 'backstop-gone', ...parkedSessions]

  beforeEach(async () => {
    await client!.del(QUEUED_SESSIONS_KEY, CLAIM, ...all.map((id) => pendingKey(OWNER, id)))
    localQueues.clear()
    started.length = 0
    installQueuedTurnStarter(async (_userId, sessionId) => {
      started.push(sessionId)
    })
    await seed('backstop-waiting', waiting('left waiting'))
    await seed('backstop-gone')
    for (const id of parkedSessions) await seed(id, parked(id))
    commands.length = 0
  })

  test('a tick reads every indexed queue in one round trip and starts only a waiting one', async () => {
    await sweepQueuedSessions('0')
    await flush()
    expect(started).toEqual(['backstop-waiting'])
    // The claim, the index page, one pipeline of 12 queue reads, dropping the gone
    // queue's entry, and the started session's own check before its turn.
    expect(count()).toEqual({ set: 1, sscan: 1, pipeline: 1, lrange: 13, eval: 1 })
    expect(await client!.sismember(QUEUED_SESSIONS_KEY, `${OWNER}:backstop-gone`)).toBe(0)
  })

  test('only one replica sweeps the shared index per tick', async () => {
    await sweepQueuedSessions('0')
    await flush()
    commands.length = 0
    // Another replica's tick inside the same 2 s.
    await sweepQueuedSessions('0')
    await flush()
    expect(count()).toEqual({ set: 1 })
  })

  test('a replica that lost the tick still starts its own in-memory queue', async () => {
    await client!.set(CLAIM, 'other-replica', 'PX', 10_000)
    localQueues.set(pendingKey(OWNER, 'backstop-local'), [waiting('kept in memory')])
    await sweepQueuedSessions('0')
    await flush()
    expect(started).toEqual(['backstop-local'])
  })

  test('a replica mid-scan that keeps losing the tick still starts its in-memory queue', async () => {
    // Redis down: the claim fails every tick, and the queue only exists in memory.
    await client!.set(CLAIM, 'other-replica', 'PX', 10_000)
    localQueues.set(pendingKey(OWNER, 'backstop-outage'), [waiting('kept in memory')])
    const next = await sweepQueuedSessions('17')

    await sweepQueuedSessions(next)
    await flush()
    expect(started).toEqual(['backstop-outage'])
  })
})
