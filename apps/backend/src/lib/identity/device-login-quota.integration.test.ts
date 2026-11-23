import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import Redis from 'ioredis'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useRedis } from '@/lib/test/doubles/redis'

import type { Quota } from './device-login-quota'

// Run with: cd apps/backend && TEST_REDIS_URL=redis://127.0.0.1:6379/0 bun test src/lib/identity/device-login-quota.integration.test.ts

// What this suite is about is Redis's behaviour, not a stand-in's: the atomic
// increment-plus-expiry, and a refusal that increments nothing, are properties
// of the Lua script running on the server. So it runs against a real Redis —
// CI's `redis` service sets TEST_REDIS_URL — and skips without one, the way
// `run-store/resume-expired.integration.test.ts` does.
const client = process.env.TEST_REDIS_URL ? new Redis(process.env.TEST_REDIS_URL) : null
const redisUrl = process.env.TEST_REDIS_URL
const installRedis = useRedis({
  redisEnabled: () => Boolean(client),
  // withRedis stays real — its timeout and fail-closed handling are part of what
  // is under test — and resolves its client through here.
  getRedis: () => client,
})

const { redisQuota } = await import('./device-login-quota')
const { createCliAuthRoutes } = await import('@/routes/cli-auth')

afterAll(() => client?.disconnect())

const KEY = 'device-login-quota:integration'
const IP_KEY_PREFIX = 'device-login:ip:'
// Well above the limit a headerless bucket can hold: the loop that needs this
// many calls is proof the bucket is not bounded at all.
const SPEND_CEILING = 1_000

const inserted: { requesterIp?: string }[] = []

useDb({
  db: () => ({
    collection: () => ({
      insertOne: (doc: { requesterIp?: string }) => {
        inserted.push(doc)

        return Promise.resolve({ insertedId: 'device_login' })
      },
    }),
  }),
})

/** `POST /auth/device`, over the real quota unless a test injects its own. */
function deviceApp(quota?: Quota) {
  const routes = new Hono()
    .onError(errorHandler)
    .route('/auth', quota ? createCliAuthRoutes(quota) : createCliAuthRoutes())

  return (headers?: Record<string, string>) =>
    routes.request('/auth/device', { method: 'POST', ...(headers ? { headers } : {}) })
}

beforeEach(async () => {
  installRedis()
  inserted.length = 0
  if (!client) return
  const shared = await client.keys(`${IP_KEY_PREFIX}*`)

  await client.del(KEY, ...shared)
})

describe.skipIf(!client)('redisQuota against a real Redis', () => {
  test('100 concurrent calls against a limit of 20 allow exactly 20', async () => {
    const verdicts = await Promise.all(Array.from({ length: 100 }, () => redisQuota(KEY, 20, 60)))

    expect(verdicts.filter((verdict) => verdict === true)).toHaveLength(20)
    expect(verdicts.filter((verdict) => verdict === false)).toHaveLength(80)
  })

  test('the window is set with the first increment, so the key is never left without one', async () => {
    expect(await redisQuota(KEY, 20, 60)).toBe(true)
    const ttl = await client!.ttl(KEY)

    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })

  test('refused calls increment nothing, so the counter stops at the limit', async () => {
    for (let call = 0; call < 100; call++) await redisQuota(KEY, 20, 60)

    // 20, not 100: the 80 refusals were never counted, and the window they are
    // refused in still has its TTL rather than having been pushed out.
    expect(await client!.get(KEY)).toBe('20')
    expect(await client!.ttl(KEY)).toBeGreaterThan(0)
  })

  test('a configured Redis that cannot be reached is 503, an unconfigured backend allows', async () => {
    const outage = new Redis(redisUrl!)

    await outage.ping()
    // As close to "the service is stopped" as a test can get: a connection that
    // was working and is not any more.
    outage.disconnect()
    try {
      installRedis({ getRedis: () => outage })
      expect(await redisQuota(KEY, 20, 60)).toBe('unavailable')

      const down = await deviceApp()({ 'CF-Connecting-IP': '203.0.113.9' })

      expect(down.status).toBe(503)
      expect(await down.json()).toMatchObject({ error: { code: 'quota_unavailable' } })
    } finally {
      outage.disconnect()
    }

    // No Redis at all is the local-dev case: nothing is shared and nothing limits.
    installRedis({ redisEnabled: () => false })
    expect(await redisQuota(KEY, 20, 60)).toBe(true)
    expect((await deviceApp()({ 'CF-Connecting-IP': '203.0.113.9' })).status).toBe(200)
  })

  test('an IP-less caller is bounded by the shared bucket, and a caller with an IP is not', async () => {
    const start = deviceApp()

    expect((await start()).status).toBe(200)

    let refusedAt = 0

    for (let call = 2; call <= SPEND_CEILING && refusedAt === 0; call++) {
      if ((await start()).status === 429) refusedAt = call
    }

    // Finite, and far above the 20/hour that used to hold every IP-less caller
    // together. Zero here would mean the bucket never filled.
    expect(refusedAt).toBeGreaterThan(100)
    // No IP was invented to key any of them.
    expect(inserted.every((doc) => doc.requesterIp === undefined)).toBe(true)

    const shared = await client!.keys(`${IP_KEY_PREFIX}*`)

    expect(shared).toHaveLength(1)
    expect(await client!.ttl(shared[0]!)).toBeGreaterThan(0)

    // Spent in Redis, so every replica refuses too, not just this one.
    expect((await deviceApp()()).status).toBe(429)

    // A caller with an address has its own bucket, spent or not.
    expect((await start({ 'CF-Connecting-IP': '203.0.113.9' })).status).toBe(200)
    expect(inserted.at(-1)?.requesterIp).toBe('203.0.113.9')
  })
})
