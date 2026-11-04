import { redisEnabled, withRedis } from '@/lib/redis'

import { RUN_KEY_TTL_SEC, streamKey } from './shared'

// The channels whose posts started or were steered into a turn, keyed by its
// stream. A reader finds them through the session's active run, so they stop
// counting the moment the turn ends; the key itself lapses with the stream's.
const channelsKey = (userId: string, streamId: string) => `${streamKey(userId, streamId)}:channels`

export async function addRunChannels(
  userId: string,
  streamId: string,
  channelIds: string[],
): Promise<void> {
  if (!redisEnabled() || channelIds.length === 0) return
  const key = channelsKey(userId, streamId)

  await withRedis((c) =>
    c
      .pipeline()
      .sadd(key, ...channelIds)
      .expire(key, RUN_KEY_TTL_SEC)
      .exec(),
  )
}

export async function readRunChannels(userId: string, streamId: string): Promise<string[]> {
  if (!redisEnabled()) return []

  return (await withRedis((c) => c.smembers(channelsKey(userId, streamId)))) ?? []
}
