import { afterAll, describe, expect, test } from 'bun:test'
import Redis from 'ioredis'

import { useRedis } from '@/lib/test/doubles/redis'

process.env.MONGODB_URI ??= 'mongodb://localhost:27017'

// Finding runs and queues must not walk the keyspace: every replica sweeps
// every 2 s through the shared client. Lua, MULTI and SSCAN need a real Redis;
// CI sets TEST_REDIS_URL.
const client = process.env.TEST_REDIS_URL ? new Redis(process.env.TEST_REDIS_URL) : null
const commands: string[] = []
const recording = client
  ? new Proxy(client, {
      get: (target, name) => {
        if (typeof name === 'string') commands.push(name)
        const value: unknown = Reflect.get(target, name)

        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  : null

useRedis({
  redisEnabled: () => Boolean(client),
  withRedis: (async (op: (redis: unknown) => unknown) =>
    recording ? op(recording) : null) as never,
})

const { flushGuardWrites, startAgentRunOwnership } = await import('../run-store')
const { sweepAbandonedAgentRuns } = await import('./ownership')
const { ABANDONED_GUARD_GRACE_MS, ACTIVE_RUN_TTL_SEC } = await import('./shared')
const { RUNTIME_HANDOFFS_KEY } = await import('@/lib/claude-code-preview/runtime-handoff-store')
const handoff = (await import('@/lib/claude-code-preview/runtime-handoff')) as Record<
  string,
  unknown
>

const USER = 'index-user'
const INDEX = 'atlas:agentrun-active-sessions'
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

async function sweepAll() {
  let cursor = '0'

  do cursor = await sweepAbandonedAgentRuns(cursor)
  while (cursor !== '0')
}

afterAll(() => client?.disconnect())

describe.skipIf(!client)('run and queue indexes', () => {
  test('the abandoned-run sweep finds a dead run from the index, without SCAN', async () => {
    const redis = client!
    const session = 'index-abandoned'
    const release = startAgentRunOwnership(USER, session, 'index-stream-1', {
      teamId: 'index-team',
      heartbeatMs: 1_000_000,
    })

    try {
      await flush()
      // The replica died: its lease is gone and the guard's TTL has decayed.
      await redis.del(`atlas:agentrun:${USER}:index-stream-1:owner`)
      await redis.pexpire(
        `atlas:agentrun-active:${USER}:${session}`,
        ACTIVE_RUN_TTL_SEC * 1_000 - ABANDONED_GUARD_GRACE_MS - 1_000,
      )
      commands.length = 0
      await sweepAll()
      expect(commands).not.toContain('scan')
      expect(await redis.exists(`atlas:agentrun-active:${USER}:${session}`)).toBe(0)
      expect(await redis.hexists(RUNTIME_HANDOFFS_KEY, `index-team:${session}`)).toBe(1)
      expect(await redis.sismember(INDEX, `${USER}:${session}`)).toBe(0)
    } finally {
      release()
      await flushGuardWrites(5_000)
      await redis.hdel(RUNTIME_HANDOFFS_KEY, `index-team:${session}`)
    }
  })

  test('a run is indexed while it holds the session, and leaves the index when released', async () => {
    const redis = client!
    const session = 'index-released'
    const release = startAgentRunOwnership(USER, session, 'index-stream-2', {
      heartbeatMs: 1_000_000,
    })

    await flush()
    expect(await redis.sismember(INDEX, `${USER}:${session}`)).toBe(1)
    release()
    await flushGuardWrites(5_000)
    expect(await redis.exists(`atlas:agentrun-active:${USER}:${session}`)).toBe(0)
    expect(await redis.sismember(INDEX, `${USER}:${session}`)).toBe(0)
  })

  test('one pass at boot indexes the queues and runs an older replica left', async () => {
    const redis = client!
    const queue = `atlas:agentrun-pending:${USER}:index-old-queue`
    const run = `atlas:agentrun-active:${USER}:index-old-run`

    await redis.rpush(queue, JSON.stringify({ id: 'old', renderedText: 'left', source: 'app' }))
    await redis.hset(run, 'streamId', 'old-stream')
    try {
      const backfill = handoff.backfillRunIndexes

      expect(typeof backfill).toBe('function')
      await (backfill as () => Promise<void>)()
      expect(
        await redis.sismember('atlas:agentrun-pending-sessions', `${USER}:index-old-queue`),
      ).toBe(1)
      expect(await redis.sismember(INDEX, `${USER}:index-old-run`)).toBe(1)
    } finally {
      await redis.del(queue, run)
      await redis.srem('atlas:agentrun-pending-sessions', `${USER}:index-old-queue`)
      await redis.srem(INDEX, `${USER}:index-old-run`)
    }
  })
})
