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

/** Up to `count` mirrored frames of a run after entry id `after` ('-' from the
 *  start), oldest first, with their entry ids. Null when Redis is off. */
export async function readAgentRunFramesAfter(
  userId: string,
  streamId: string,
  after: string,
  count: number,
): Promise<{ id: string; frame: string }[] | null> {
  if (!redisEnabled()) return null
  // Inclusive start, so the cursor's own entry is dropped below.
  const raw = await withRedis((c) =>
    c.xrange(streamKey(userId, streamId), after, '+', 'COUNT', count + 1),
  )

  if (!raw) return null

  return parseEntries(raw)
    .filter((entry) => entry.id !== after)
    .slice(0, count)
}
