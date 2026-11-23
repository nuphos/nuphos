import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { createCliAuthRoutes } from '@/routes/cli-auth'

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

/** The route under test with a quota that answers `verdict`, recording every key it is asked about. */
function deviceRoute(verdict: boolean | 'unavailable') {
  const codes: string[] = []
  const routes = new Hono().onError(errorHandler).route(
    '/auth',
    createCliAuthRoutes((key) => {
      codes.push(key)

      return Promise.resolve(verdict)
    }),
  )

  return {
    codes,
    start: (headers?: Record<string, string>) =>
      routes.request('/auth/device', { method: 'POST', ...(headers ? { headers } : {}) }),
  }
}

const errorCode = (response: Response) =>
  response.json().then((body) => (body as { error?: { code?: string } }).error?.code)

beforeEach(() => {
  inserted.length = 0
})

test('POST /auth/device counts a request from a known client IP, hashed', async () => {
  const { codes, start } = deviceRoute(true)

  expect((await start({ 'CF-Connecting-IP': '203.0.113.9' })).status).toBe(200)
  expect(codes).toHaveLength(1)
  expect(codes[0]?.startsWith('device-login:ip:')).toBe(true)
  // Hashed, not the address itself: a Redis key must not carry a person's IP.
  expect(codes[0]).not.toContain('203.0.113.9')
  // One caller shares one bucket; a different IP gets its own.
  await start({ 'CF-Connecting-IP': '203.0.113.9' })
  expect(codes).toHaveLength(2)
  expect(codes[1]).toBe(codes[0])
  await start({ 'X-Forwarded-For': '198.51.100.4' })
  expect(codes[2]).not.toBe(codes[0])
})

test('POST /auth/device refuses a caller over the IP quota, and reports an outage as 503', async () => {
  const limited = await deviceRoute(false).start({ 'CF-Connecting-IP': '203.0.113.9' })

  expect(limited.status).toBe(429)
  expect(await errorCode(limited)).toBe('rate_limited')

  const down = await deviceRoute('unavailable').start({ 'CF-Connecting-IP': '203.0.113.9' })

  expect(down.status).toBe(503)
  expect(await errorCode(down)).toBe('quota_unavailable')
})

test('POST /auth/device skips the IP quota when there is no usable client IP', async () => {
  // A bucket that is already spent. Keyed on a shared "unknown" hash it would
  // refuse every headerless caller together, so one of them could spend the
  // budget of another; skipped, none of them is counted and none blocks another.
  const { codes, start } = deviceRoute(false)

  expect((await start()).status).toBe(200)
  expect((await start()).status).toBe(200)
  expect((await start({ 'X-Forwarded-For': 'not-an-address' })).status).toBe(200)
  expect(codes).toEqual([])
  expect(inserted).toHaveLength(3)
  // No fabricated requester either: a sign-in records an IP only when there is one.
  expect(inserted.every((doc) => doc.requesterIp === undefined)).toBe(true)
})
