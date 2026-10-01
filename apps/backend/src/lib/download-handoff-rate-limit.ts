import { withRedis } from '@/lib/redis'

export type DownloadHandoffRateLimitResult = 'allowed' | 'limited' | 'unavailable'

const IP_LIMIT = 5
const IP_WINDOW_SECONDS = 60 * 60
const RECIPIENT_LIMIT = 3
const RECIPIENT_WINDOW_SECONDS = 24 * 60 * 60

// Both quotas are checked and consumed in one Redis operation. A rejected
// request increments neither counter, so retries cannot exhaust the other
// dimension accidentally. Redis is shared by every backend replica.
const CONSUME_QUOTA_SCRIPT = `
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

export async function consumeDownloadHandoffRateLimit(input: {
  ipHash: string
  recipientHash: string
}): Promise<DownloadHandoffRateLimitResult> {
  const result = await withRedis((client) =>
    client.eval(
      CONSUME_QUOTA_SCRIPT,
      2,
      `download-handoff:ip:${input.ipHash}`,
      `download-handoff:recipient:${input.recipientHash}`,
      IP_LIMIT,
      IP_WINDOW_SECONDS,
      RECIPIENT_LIMIT,
      RECIPIENT_WINDOW_SECONDS,
    ),
  )

  if (result === 1) return 'allowed'
  if (result === 0) return 'limited'

  // Sending mail without a shared quota would recreate the public bulk-mail
  // primitive this guard exists to close, so Redis failure is fail-closed.
  return 'unavailable'
}
