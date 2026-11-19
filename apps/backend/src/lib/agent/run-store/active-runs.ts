import { redisEnabled, withRedis } from '@/lib/redis'

import { channelsKey } from './run-channels'
import { activeRunKey } from './shared'

export type ListedRun = {
  streamId: string
  startedAt: string | null
  actorUserId: string | null
  runtimeOwned: boolean
  channelIds: string[]
}

/**
 * A page's live runs and the channels they answer, in two round trips whatever
 * the page holds. Every client polls the list, so it never checks a run for
 * abandonment: the 2 s sweep removes a dead guard, and until then its run shows.
 */
export async function getActiveAgentRunsForSessions(
  sessions: { userId: string; sessionId: string }[],
): Promise<(ListedRun | null)[]> {
  if (!redisEnabled() || sessions.length === 0) return sessions.map(() => null)
  const guards = await withRedis((c) =>
    sessions
      .reduce(
        (read, { userId, sessionId }) =>
          read.hmget(
            activeRunKey(userId, sessionId),
            'streamId',
            'startedAt',
            'actorUserId',
            'runtimeOwned',
          ),
        c.pipeline(),
      )
      .exec(),
  )
  const runs = sessions.map((_, i) => {
    const [streamId, startedAt = null, actorUserId = null, runtimeOwned] =
      (guards?.[i]?.[1] as (string | null)[] | undefined) ?? []

    return streamId
      ? { streamId, startedAt, actorUserId, runtimeOwned: runtimeOwned === '1' }
      : null
  })
  const channels = runs.some(Boolean)
    ? await withRedis((c) =>
        sessions
          .reduce((read, { userId }, i) => {
            const run = runs[i]

            return run ? read.smembers(channelsKey(userId, run.streamId)) : read
          }, c.pipeline())
          .exec(),
      )
    : null
  let next = 0

  return runs.map((run) =>
    run ? { ...run, channelIds: (channels?.[next++]?.[1] as string[] | undefined) ?? [] } : null,
  )
}
