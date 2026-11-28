import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import Redis from 'ioredis'

import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useRedis } from '@/lib/test/doubles/redis'

// Run with: cd apps/backend && TEST_REDIS_URL=redis://127.0.0.1:6379/0 bun test src/lib/identity/device-login-quota.integration.test.ts

// What this suite is about is Redis's behaviour, not a stand-in's: the atomic
// increment-plus-expiry, and a refusal that increments nothing, are properties
// of the Lua script running on the server. So it runs against a real Redis —
// CI's `redis` service sets TEST_REDIS_URL — and skips without one, the way
// `run-store/resume-expired.integration.test.ts` does.
const redisUrl = process.env.TEST_REDIS_URL
const inCi = Boolean(process.env.CI)
const client = redisUrl ? new Redis(redisUrl) : null
const installRedis = useRedis({
  redisEnabled: () => Boolean(client),
  // withRedis stays real — its timeout and fail-closed handling are part of what
  // is under test — and resolves its client through here.
  getRedis: () => client,
})

const { redisQuota } = await import('./device-login-quota')
const { createCliAuthRoutes, HEADERLESS_SIGN_IN_KEY, HEADERLESS_SIGN_IN_LIMIT, IP_SIGN_IN_LIMIT } =
  await import('@/routes/cli-auth')

/** One line of the evidence block this suite prints for the review that asked for it. */
function evidence(line: string) {
  // eslint-disable-next-line no-console -- evidence for review
  console.log(`[device-login-quota evidence] ${line}`)
}

/** `redis_version` read off the server, so the log names what it actually ran against. */
async function redisVersion(): Promise<string> {
  const info = await client!.info('server')

  return /redis_version:([\d.]+)/.exec(info)?.[1] ?? 'unknown'
}

afterAll(() => client?.disconnect())

// The unit-level key, and every route key this suite can create — so a rerun
// starts from an empty window and no other suite sharing the Redis service sees
// its own keys deleted.
const KEY = 'device-login-quota:integration'
const ROUTE_KEY_GLOB = 'device-login:ip:*'
// Requests past the per-IP limit, fired concurrently: the excess is what must be refused.
const IP_OVERAGE = 5
const FIRST_IP = '203.0.113.7'
const OTHER_IP = '198.51.100.4'
// Not an address, so `clientIp()` ignores it exactly as it ignores no header at all.
const MALFORMED_IP = 'not-an-address'

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

/** `POST /auth/device` over the real `redisQuota`: nothing in this suite injects a fake. */
function deviceApp() {
  const routes = new Hono().onError(errorHandler).route('/auth', createCliAuthRoutes())

  return (headers?: Record<string, string>) =>
    routes.request('/auth/device', { method: 'POST', ...(headers ? { headers } : {}) })
}

const errorCode = (response: Response) =>
  response.json().then((body) => (body as { error?: { code?: string } }).error?.code)

beforeEach(async () => {
  installRedis()
  inserted.length = 0
  if (!client) return
  const routeKeys = await client.keys(ROUTE_KEY_GLOB)

  await client.del(KEY, ...routeKeys)
})

test.skipIf(!inCi || Boolean(redisUrl))('the CI job provides TEST_REDIS_URL', () => {
  // A job that lost its redis service, or never exported TEST_REDIS_URL to the
  // step, would otherwise go green with every test below skipped — and nothing
  // else checks that the increment and its expiry are one atomic step.
  throw new Error(
    'TEST_REDIS_URL is unset, so this suite would have been skipped: it must run against a ' +
      'real Redis in CI (the `redis` service in .github/workflows/ci.yml).',
  )
})

describe.skipIf(!client)('redisQuota against a real Redis', () => {
  test('100 concurrent calls against a limit of 20 allow exactly 20', async () => {
    const N = 100
    const L = 20
    const verdicts = await Promise.all(Array.from({ length: N }, () => redisQuota(KEY, L, 60)))
    const allowed = verdicts.filter((verdict) => verdict === true).length
    const refused = verdicts.filter((verdict) => verdict === false).length
    const counter = await client!.get(KEY)

    evidence(`redis server under test: redis_version=${await redisVersion()}`)
    evidence(`N=${String(N)} L=${String(L)}`)
    evidence(`allowed=${String(allowed)} refused=${String(refused)}`)
    evidence(`counter after the concurrent batch=${String(counter)}`)
    // The script checks the count before it increments, so exactly the limit gets
    // through however many callers arrive at once.
    expect(allowed).toBe(L)
    expect(refused).toBe(N - L)
  })

  test('the window is set with the first increment, so the key is never left without one', async () => {
    const windowSec = 60

    expect(await redisQuota(KEY, 20, windowSec)).toBe(true)
    const ttl = await client!.ttl(KEY)

    evidence(`ttl after the first call=${String(ttl)}s window=${String(windowSec)}s`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(windowSec)
  })

  test('refused calls increment nothing, so the counter stops at the limit', async () => {
    const attempts = 100
    const limit = 20

    for (let call = 0; call < attempts; call++) await redisQuota(KEY, limit, 60)
    const counter = await client!.get(KEY)

    evidence(`counter after ${String(attempts)} attempts at limit=${String(limit)}`)
    evidence(`counter=${String(counter)}`)
    // No more than the limit: the refusals were never counted, and the window
    // they are refused in still has its TTL rather than having been pushed out.
    expect(counter).toBe(String(limit))
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
      const verdict = await redisQuota(KEY, 20, 60)
      const down = await deviceApp()({ 'CF-Connecting-IP': FIRST_IP })
      const downCode = await errorCode(down)

      evidence(`configured but unreachable: redisQuota=${String(verdict)}`)
      evidence(`configured but unreachable: POST /auth/device=${String(down.status)}`)
      evidence(`configured but unreachable: code=${String(downCode)}`)
      expect(verdict).toBe('unavailable')
      expect(down.status).toBe(503)
      expect(downCode).toBe('quota_unavailable')
    } finally {
      outage.disconnect()
    }

    // No Redis at all is the local-dev case: nothing is shared and nothing limits.
    installRedis({ redisEnabled: () => false })
    const unconfigured = await redisQuota(KEY, 20, 60)
    const allowed = await deviceApp()({ 'CF-Connecting-IP': FIRST_IP })

    evidence(`not configured: redisQuota=${String(unconfigured)}`)
    evidence(`not configured: POST /auth/device=${String(allowed.status)}`)
    expect(unconfigured).toBe(true)
    expect(allowed.status).toBe(200)
  })

  test('POST /auth/device: one client IP gets 20 an hour, and only its own', async () => {
    const start = deviceApp()
    const first = { 'X-Forwarded-For': FIRST_IP }
    const requests: (Response | Promise<Response>)[] = []

    for (let call = 0; call < IP_SIGN_IN_LIMIT + IP_OVERAGE; call++) {
      requests.push(start(first))
    }
    const responses = await Promise.all(requests)
    const ok = responses.filter((response) => response.status === 200).length
    const refused = responses.filter((response) => response.status === 429)
    const refusedCodes = await Promise.all(refused.map((response) => errorCode(response)))
    const other = await start({ 'X-Forwarded-For': OTHER_IP })

    evidence(`route IP=${FIRST_IP}: ${String(responses.length)} concurrent`)
    evidence(`route IP=${FIRST_IP}: ok=${String(ok)} refused=${String(refused.length)}`)
    evidence(`route IP=${FIRST_IP}: 429 codes=${[...new Set(refusedCodes)].join(',')}`)
    evidence(`route IP=${OTHER_IP}: ${String(other.status)} with the first IP spent`)
    expect(ok).toBe(IP_SIGN_IN_LIMIT)
    expect(refused).toHaveLength(IP_OVERAGE)
    expect(refusedCodes.every((code) => code === 'rate_limited')).toBe(true)
    // The spent bucket is one address's, so it says nothing about another.
    expect(other.status).toBe(200)
  })

  test('POST /auth/device: IP-less callers share one bounded bucket', async () => {
    const start = deviceApp()
    const requests: (Response | Promise<Response>)[] = []

    for (let call = 0; call < HEADERLESS_SIGN_IN_LIMIT; call++) {
      // Half carry no IP header at all, half a malformed one: `clientIp()` finds
      // no address in either, so both are keyed by the shared headerless bucket.
      if (call % 2 === 0) {
        requests.push(start())
      } else {
        requests.push(start({ 'X-Forwarded-For': MALFORMED_IP }))
      }
    }
    const responses = await Promise.all(requests)
    const ok = responses.filter((response) => response.status === 200).length
    const spent = await start({ 'X-Forwarded-For': MALFORMED_IP })
    const spentCode = await errorCode(spent)
    const ttl = await client!.ttl(HEADERLESS_SIGN_IN_KEY)

    // No address was invented for any of them, so a sign-in records one only when
    // the caller actually sent one.
    expect(inserted.every((doc) => doc.requesterIp === undefined)).toBe(true)
    // The bucket lives in Redis, so a second app instance refuses too.
    expect((await deviceApp()()).status).toBe(429)

    const unaffected = await start({ 'X-Forwarded-For': OTHER_IP })

    evidence(`route headerless key=${HEADERLESS_SIGN_IN_KEY}`)
    evidence(`route headerless limit=${String(HEADERLESS_SIGN_IN_LIMIT)} ok=${String(ok)}`)
    evidence(`route headerless ttl=${String(ttl)}s`)
    evidence(`route headerless next=${String(spent.status)} code=${String(spentCode)}`)
    evidence(`route IP=${OTHER_IP} after the headerless bucket=${String(unaffected.status)}`)
    // Exactly the limit gets through, and the bucket is finite: the request past
    // it is refused rather than the counter growing.
    expect(ok).toBe(HEADERLESS_SIGN_IN_LIMIT)
    expect(spent.status).toBe(429)
    expect(spentCode).toBe('rate_limited')
    expect(unaffected.status).toBe(200)
  })
})
