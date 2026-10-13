import { createHash } from 'node:crypto'

import { db } from '@/lib/db'
import { withRedis } from '@/lib/redis'

import type { feedbackRequestSchema } from '@/lib/api/feedback'
import type { z } from 'zod'

export type FeedbackReport = z.output<typeof feedbackRequestSchema>
export type FeedbackRateLimitResult = 'allowed' | 'limited' | 'unavailable'

type FeedbackDocument = FeedbackReport & { ip: string; createdAt: Date }

const reports = () => db().collection<FeedbackDocument>('feedback_reports')

const CLIENT_LIMIT = 5
const GLOBAL_LIMIT = 60
const WINDOW_SECONDS = 60 * 60

// Same shape as the download-handoff quota: both counters are checked and
// consumed atomically, and a rejected request increments neither. The global
// cap bounds the triage queue even if client addresses are spoofed or collapse
// onto one proxy address.
const CONSUME_QUOTA_SCRIPT = `
local client_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local global_count = tonumber(redis.call('GET', KEYS[2]) or '0')

if client_count >= tonumber(ARGV[1]) or global_count >= tonumber(ARGV[2]) then
  return 0
end

if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end

return 1
`

export async function consumeFeedbackRateLimit(clientIp: string): Promise<FeedbackRateLimitResult> {
  const clientHash = createHash('sha256').update(clientIp).digest('hex')
  const result = await withRedis((client) =>
    client.eval(
      CONSUME_QUOTA_SCRIPT,
      2,
      `feedback:client:${clientHash}`,
      'feedback:global',
      CLIENT_LIMIT,
      GLOBAL_LIMIT,
      WINDOW_SECONDS,
    ),
  )

  if (result === 1) return 'allowed'
  if (result === 0) return 'limited'

  // Without a shared quota the endpoint is an unbounded public write, so
  // Redis failure is fail-closed.
  return 'unavailable'
}

// Reports wait for a human: nothing leaves the database until triage.
export async function saveFeedbackReport(
  report: FeedbackReport,
  ip: string,
): Promise<{ id: string }> {
  const { insertedId } = await reports().insertOne({ ...report, ip, createdAt: new Date() })

  return { id: insertedId.toHexString() }
}
