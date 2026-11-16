import { redisEnabled, withRedis } from '@/lib/redis'

import { getActiveAgentRunForSession } from './ownership'
import { activeRunKey } from './shared'

type ActiveRun = Awaited<ReturnType<typeof getActiveAgentRunForSession>>

/**
 * Many sessions' live runs in one Redis round trip. Asked one session at a time, a
 * page of conversations put up to 100 commands on the shared connection at once, so
 * a single event-loop stall timed every one of them out. Only a session that has a
 * guard is read in full, which also checks that its run was not abandoned.
 */
export async function getActiveAgentRunsForSessions(
  sessions: { userId: string; sessionId: string }[],
): Promise<ActiveRun[]> {
  if (!redisEnabled() || sessions.length === 0) return sessions.map(() => null)
  const guards = await withRedis((c) =>
    sessions
      .reduce((p, { userId, sessionId }) => p.exists(activeRunKey(userId, sessionId)), c.pipeline())
      .exec(),
  )

  return Promise.all(
    sessions.map(async ({ userId, sessionId }, i) =>
      guards?.[i]?.[1] ? getActiveAgentRunForSession(userId, sessionId) : null,
    ),
  )
}
