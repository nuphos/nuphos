import { AppError } from '@/lib/errors'
import { redisEnabled, withRedis } from '@/lib/redis'

export type Quota = (key: string, limit: number, windowSec: number) => Promise<boolean>

/** Fixed-window counter in Redis. Without Redis configured (local dev) it never limits. */
export const redisQuota: Quota = async (key, limit, windowSec) => {
  const count = await withRedis(async (client) => {
    const n = await client.incr(key)

    if (n === 1) await client.expire(key, windowSec)

    return n
  })

  return count === null ? !redisEnabled() : count <= limit
}

/**
 * Codes are guessable only by trying: cap tries per approving user. Every page that looks up or
 * decides a user code shares this key, so a second page is not a second budget.
 */
export async function deviceGuessQuota(userId: string, quota: Quota) {
  if (!(await quota(`device-login:approve:${userId}`, 30, 600))) {
    throw new AppError(429, 'rate_limited', 'Too many attempts; wait a few minutes')
  }
}
