import { redisEnabled, withRedis } from '@/lib/redis'

import { parseEntries, streamKey } from './shared'

/** One read of a run's mirrored frames, as a resuming client would backfill
 *  them. `lastFrameAt` is the append time Redis put in the last entry id. */
export async function readAgentRunFrames(
  userId: string,
  streamId: string,
): Promise<{ frames: string[]; lastFrameAt: number | null } | null> {
  if (!redisEnabled()) return null
  const raw = await withRedis((c) => c.xrange(streamKey(userId, streamId), '-', '+'))

  if (!raw) return null
  const entries = parseEntries(raw)
  const lastFrameAt = Number(entries.at(-1)?.id.split('-')[0])

  return {
    frames: entries.map((entry) => entry.frame),
    lastFrameAt: Number.isFinite(lastFrameAt) ? lastFrameAt : null,
  }
}
