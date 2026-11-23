import { beforeEach, describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useRedis } from '@/lib/test/doubles/redis'

// Run with: cd apps/backend && bun test src/lib/identity/device-login-quota.test.ts

// Mirrors the CONSUME_QUOTA_SCRIPT's GET / INCR / EXPIRE against the one key it
// is called with, so `counts` and `expiries` are the Redis state the quota reads
// back. `configured` stands in for redisEnabled(): with it false the real
// withRedis() returns null without touching Redis at all.
const counts = new Map<string, number>()
const expiries = new Map<string, number>()
let configured = true
let available = true

const redis = {
  eval: (script: string, _keys: number, key: string, limit: number, windowSeconds: number) => {
    if (!script.includes("redis.call('INCR'")) return Promise.resolve(null)
    const count = counts.get(key) ?? 0

    if (count >= limit) return Promise.resolve(0)
    counts.set(key, count + 1)
    if (count === 0) expiries.set(key, windowSeconds)

    return Promise.resolve(1)
  },
}

useRedis({
  redisEnabled: () => configured,
  withRedis: (op: (client: typeof redis) => Promise<unknown>) =>
    configured && available ? op(redis) : Promise.resolve(null),
} as never)
const { deviceGuessQuota, quotaRefusal, redisQuota } = await import('./device-login-quota')

beforeEach(() => {
  counts.clear()
  expiries.clear()
  configured = true
  available = true
})

describe('redisQuota', () => {
  test('allows requests under the limit and refuses the one at it', async () => {
    expect(await redisQuota('k', 2, 60)).toBe(true)
    expect(await redisQuota('k', 2, 60)).toBe(true)
    expect(await redisQuota('k', 2, 60)).toBe(false)
  })

  test('counts a window per key, so one key cannot spend another', async () => {
    expect(await redisQuota('a', 1, 60)).toBe(true)
    expect(await redisQuota('b', 1, 60)).toBe(true)
    expect(await redisQuota('a', 1, 60)).toBe(false)
  })

  test('sets the TTL with the first increment, in the same operation', async () => {
    await redisQuota('k', 5, 60)
    expect(expiries.get('k')).toBe(60)
  })

  test('a refused request counts nothing', async () => {
    for (let attempt = 0; attempt < 5; attempt++) await redisQuota('k', 2, 60)

    // Not 5: only the two that were allowed were ever incremented, so retrying
    // a refusal cannot exhaust the window or push its reset further out.
    expect(counts.get('k')).toBe(2)
  })

  test('unavailable when Redis is configured but down, allowed when it is not configured', async () => {
    available = false
    expect(await redisQuota('k', 2, 60)).toBe('unavailable')
    configured = false
    expect(await redisQuota('k', 2, 60)).toBe(true)
  })
})

describe('quotaRefusal', () => {
  test('reads an over-limit refusal and an outage apart', () => {
    expect(quotaRefusal(true, 'slow down')).toBeUndefined()
    expect(quotaRefusal(false, 'slow down')).toMatchObject({ status: 429, code: 'rate_limited' })
    expect(quotaRefusal('unavailable', 'slow down')).toMatchObject({
      status: 503,
      code: 'quota_unavailable',
    })
  })
})

describe('deviceGuessQuota', () => {
  test('shares one budget per approving user', async () => {
    await deviceGuessQuota('user-1', redisQuota)

    expect([...counts.keys()]).toEqual(['device-login:approve:user-1'])
  })

  test('a spent budget refuses, and an outage is a 503 rather than a 429', async () => {
    await expect(deviceGuessQuota('user-1', () => Promise.resolve(false))).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    })
    await expect(
      deviceGuessQuota('user-1', () => Promise.resolve('unavailable' as const)),
    ).rejects.toMatchObject({
      status: 503,
      code: 'quota_unavailable',
    })
  })

  test('a real outage throws the AppError the routes render', async () => {
    available = false

    await expect(deviceGuessQuota('user-1', redisQuota)).rejects.toBeInstanceOf(AppError)
  })
})
