import { redisEnabled, withRedis } from '@/lib/redis'

import { parseEntries, streamKey } from './shared'

/** A run's latest `count` mirrored frames, oldest first. `lastFrameAt` is the
 *  append time Redis put in the newest entry id. */
export async function readAgentRunFrames(
  userId: string,
  streamId: string,
  count: number,
): Promise<{ frames: string[]; lastFrameAt: number | null } | null> {
  if (!redisEnabled()) return null
  const raw = await withRedis((c) =>
    c.xrevrange(streamKey(userId, streamId), '+', '-', 'COUNT', count),
  )

  if (!raw) return null
  const entries = parseEntries(raw).reverse()
  const lastFrameAt = Number(entries.at(-1)?.id.split('-')[0])

  return {
    frames: entries.map((entry) => entry.frame),
    lastFrameAt: Number.isFinite(lastFrameAt) ? lastFrameAt : null,
  }
}
