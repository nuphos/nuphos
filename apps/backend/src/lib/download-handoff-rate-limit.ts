import { withRedis } from '@/lib/redis'

export type DownloadHandoffRateLimitResult = 'allowed' | 'limited' | 'unavailable'

const IP_LIMIT = 5
const IP_WINDOW_SECONDS = 60 * 60
const RECIPIENT_LIMIT = 3
const RECIPIENT_WINDOW_SECONDS = 24 * 60 * 60

// Both quotas are checked and consumed in one Redis operation. A rejected
// request increments neither counter, so retries cannot exhaust the other
// dimension accidentally. Redis is shared by every backend replica.
const CONSUME_PAIR_QUOTA_SCRIPT = `
local ip_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local recipient_count = tonumber(redis.call('GET', KEYS[2]) or '0')

if ip_count >= tonumber(ARGV[1]) or recipient_count >= tonumber(ARGV[3]) then
  return 0
end

ip_count = redis.call('INCR', KEYS[1])
if ip_count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end

recipient_count = redis.call('INCR', KEYS[2])
if recipient_count == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end

return 1
`

// Single-window variant of the pair script. A rejected request increments
// nothing, so retries cannot exhaust the quota. Shared by every backend
// replica through Redis, so it bounds an attacker across pods too.
const CONSUME_QUOTA_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')

if count >= tonumber(ARGV[1]) then
  return 0
end

count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end

return 1
`

export type QuotaWindow = { key: string; limit: number; windowSeconds: number }

/**
 * Consumes one unit from a single window. A rejected request increments
 * nothing, so retries cannot exhaust the quota. Shared by every backend
 * replica through Redis, so it bounds an attacker across pods too.
 *
 * This is the primitive the email-otp path already uses; exposing it lets the
 * password route apply the same IP-keyed cap instead of nothing.
 */
export async function consumeQuota(
  window: QuotaWindow,
): Promise<DownloadHandoffRateLimitResult> {
  const result = await withRedis((client) =>
    client.eval(
      CONSUME_QUOTA_SCRIPT,
      1,
      window.key,
      window.limit,
      window.windowSeconds,
    ),
  )

  if (result === 1) return 'allowed'
  if (result === 0) return 'limited'

  return 'unavailable'
}

/** Consumes one unit from both windows atomically, or from neither. */
export async function consumePairQuota(
  first: QuotaWindow,
  second: QuotaWindow,
): Promise<DownloadHandoffRateLimitResult> {
  const result = await withRedis((client) =>
    client.eval(
      CONSUME_PAIR_QUOTA_SCRIPT,
      2,
      first.key,
      second.key,
      first.limit,
      first.windowSeconds,
      second.limit,
      second.windowSeconds,
    ),
  )

  if (result === 1) return 'allowed'
  if (result === 0) return 'limited'

  return 'unavailable'
}

export async function consumeDownloadHandoffRateLimit(input: {
  ipHash: string
  recipientHash: string
}): Promise<DownloadHandoffRateLimitResult> {
  // Sending mail without a shared quota would recreate the public bulk-mail
  // primitive this guard exists to close, so callers treat 'unavailable' as
  // fail-closed.
  return consumePairQuota(
    {
      key: `download-handoff:ip:${input.ipHash}`,
      limit: IP_LIMIT,
      windowSeconds: IP_WINDOW_SECONDS,
    },
    {
      key: `download-handoff:recipient:${input.recipientHash}`,
      limit: RECIPIENT_LIMIT,
      windowSeconds: RECIPIENT_WINDOW_SECONDS,
    },
  )
}
