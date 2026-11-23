import { consumeQuota } from '@/lib/download-handoff-rate-limit'
import { AppError } from '@/lib/errors'
import { redisEnabled } from '@/lib/redis'

/**
 * `true` allows the call, `false` refuses it, and `'unavailable'` says no
 * verdict could be reached at all. A caller must never read the third case as
 * a refusal: nothing was counted, so a client that retries is not at fault.
 */
export type QuotaVerdict = boolean | 'unavailable'

export type Quota = (key: string, limit: number, windowSec: number) => Promise<QuotaVerdict>

/**
 * Fixed-window counter in Redis, through the same Lua script the email-otp and
 * password paths use (`consumeQuota`): the increment and the expiry happen in
 * one atomic step, so a failover between them cannot leave a key that never
 * resets and permanently locks a user or IP out. A refused request increments
 * nothing either, so retries cannot exhaust the window early.
 *
 * Without Redis configured (local dev) it never limits.
 */
export const redisQuota: Quota = async (key, limit, windowSec) => {
  const result = await consumeQuota({ key, limit, windowSeconds: windowSec })

  if (result === 'allowed') return true
  if (result === 'limited') return false

  // Redis is shared by every replica, so with it configured but unreachable the
  // verdict is unknown and must not be read as permission. Unconfigured there
  // is no shared counter to consult — the local-dev case — so allow.
  return redisEnabled() ? 'unavailable' : true
}

/**
 * The refusal a verdict asks for, or `undefined` to continue. `'unavailable'`
 * is a 503 rather than a 429: the quota backend is down, which is not the
 * caller's doing, and telling them to back off would be a lie.
 */
export function quotaRefusal(verdict: QuotaVerdict, limited: string): AppError | undefined {
  if (verdict === true) return undefined
  if (verdict === false) return new AppError(429, 'rate_limited', limited)

  return new AppError(
    503,
    'quota_unavailable',
    'Sign-in is temporarily unavailable; try again shortly',
  )
}

/**
 * Codes are guessable only by trying: cap tries per approving user. Every page that looks up or
 * decides a user code shares this key, so a second page is not a second budget.
 */
export async function deviceGuessQuota(userId: string, quota: Quota) {
  const refusal = quotaRefusal(
    await quota(`device-login:approve:${userId}`, 30, 600),
    'Too many attempts; wait a few minutes',
  )

  if (refusal) throw refusal
}
