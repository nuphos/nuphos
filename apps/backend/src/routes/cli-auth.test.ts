import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { DEVICE_LOGIN_TTL_SEC } from '@/lib/identity/device-login'
import { useDb } from '@/lib/test/doubles/db'
import { createCliAuthRoutes } from '@/routes/cli-auth'

import type { Quota } from '@/lib/identity/device-login-quota'

// Run with: cd apps/backend && bun test src/routes/cli-auth.test.ts

const inserted: { clientName: string; requesterIp?: string }[] = []

useDb({
  db: () => ({
    collection: () => ({
      insertOne: (doc: { _id: string; clientName: string; requesterIp?: string }) => {
        inserted.push(doc)

        return Promise.resolve({ insertedId: doc._id })
      },
    }),
  }),
})

/** The route under test, with a quota that answers `verdict` for every key. */
function deviceApp(quota: Quota) {
  const routes = new Hono().onError(errorHandler).route('/auth', createCliAuthRoutes(quota))

  return (headers?: Record<string, string>) =>
    routes.request('/auth/device', { method: 'POST', ...(headers ? { headers } : {}) })
}

/**
 * A fixed-window counter per key, mirroring what `consumeQuota`'s Lua script
 * does in Redis: a request over the limit is refused without incrementing. The
 * limit the route asks for is therefore the number of calls it takes to spend a
 * bucket, which is what lets a test spend the real one without restating it.
 */
function countingQuota() {
  const calls: { key: string; limit: number; windowSec: number }[] = []
  const counts = new Map<string, number>()

  return {
    calls,
    quota: (key: string, limit: number, windowSec: number) => {
      calls.push({ key, limit, windowSec })
      const count = counts.get(key) ?? 0

      if (count >= limit) return Promise.resolve(false)
      counts.set(key, count + 1)

      return Promise.resolve(true)
    },
  }
}

const always =
  (result: boolean | 'unavailable'): Quota =>
  () =>
    Promise.resolve(result)

const errorCode = (response: Response) =>
  response.json().then((body) => (body as { error?: { code?: string } }).error?.code)

beforeEach(() => {
  inserted.length = 0
})

test('POST /auth/device counts a request from a known client IP, hashed', async () => {
  const { calls, quota } = countingQuota()
  const start = deviceApp(quota)

  expect((await start({ 'CF-Connecting-IP': '203.0.113.9' })).status).toBe(200)
  expect(calls).toHaveLength(1)
  expect(calls[0]?.key.startsWith('device-login:ip:')).toBe(true)
  // Hashed, not the address itself: a Redis key must not carry a person's IP.
  expect(calls[0]?.key).not.toContain('203.0.113.9')
  // One caller shares one bucket; a different IP gets its own.
  await start({ 'CF-Connecting-IP': '203.0.113.9' })
  expect(calls).toHaveLength(2)
  expect(calls[1]?.key).toBe(calls[0]?.key)
  await start({ 'X-Forwarded-For': '198.51.100.4' })
  expect(calls[2]?.key).not.toBe(calls[0]?.key)
})

test('POST /auth/device refuses a caller over the IP quota, and reports an outage as 503', async () => {
  const limited = await deviceApp(always(false))({ 'CF-Connecting-IP': '203.0.113.9' })

  expect(limited.status).toBe(429)
  expect(await errorCode(limited)).toBe('rate_limited')

  const down = await deviceApp(always('unavailable'))({ 'CF-Connecting-IP': '203.0.113.9' })

  expect(down.status).toBe(503)
  expect(await errorCode(down)).toBe('quota_unavailable')
})

test('POST /auth/device pools headerless callers into one shared, bounded bucket', async () => {
  const { calls, quota } = countingQuota()
  const start = deviceApp(quota)

  // No CF-Connecting-IP at all, and a malformed X-Forwarded-For is not an
  // address either: both fall into the one headerless bucket.
  expect((await start()).status).toBe(200)
  expect((await start({ 'X-Forwarded-For': 'not-an-address' })).status).toBe(200)

  const first = calls[0]!

  expect(calls.map((call) => call.key)).toEqual([first.key, first.key])
  expect(first.key.startsWith('device-login:ip:')).toBe(true)
  // One pending record's lifetime, so the limit is "how many may be pending at
  // once" rather than an arbitrary rate.
  expect(first.windowSec).toBe(DEVICE_LOGIN_TTL_SEC)
  // Far above the 20/hour that used to hold every IP-less caller together, so
  // normal traffic never reaches it — but finite, so unbounded inserts cannot
  // happen either.
  expect(first.limit).toBeGreaterThan(100)

  for (let call = calls.length; call < first.limit; call++) await start()

  const refused = await start()

  expect(refused.status).toBe(429)
  expect(await errorCode(refused)).toBe('rate_limited')
  // Refused at the limit, not above it: the bucket is spent, not raided.
  expect(calls).toHaveLength(first.limit + 1)
  // No fabricated requester either: a sign-in records an IP only when there is one.
  expect(inserted.every((doc) => doc.requesterIp === undefined)).toBe(true)
})

test('an exhausted headerless bucket leaves callers with a client IP alone', async () => {
  const { calls, quota } = countingQuota()
  const start = deviceApp(quota)

  await start()
  const limit = calls[0]!.limit

  for (let call = 1; call < limit; call++) await start()
  expect((await start()).status).toBe(429)

  // A different bucket, so a spent headerless one says nothing about this caller.
  expect((await start({ 'CF-Connecting-IP': '203.0.113.9' })).status).toBe(200)
  expect(calls.at(-1)?.key).not.toBe(calls[0]?.key)
})
