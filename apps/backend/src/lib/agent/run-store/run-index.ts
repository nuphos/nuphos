import { QUEUED_SESSIONS_KEY } from '@/lib/agent/pending-messages'
import { redisEnabled, withRedis } from '@/lib/redis'

import { getActiveAgentRunForSession } from './ownership'
import { ACTIVE_RUNS_KEY, activeRunKey } from './shared'

// Each index holds `userId:sessionId`; an active run's key has nothing after it.
const INDEXED = [
  { index: QUEUED_SESSIONS_KEY, prefix: 'atlas:agentrun-pending:', parts: (n: number) => n >= 2 },
  { index: ACTIVE_RUNS_KEY, prefix: 'atlas:agentrun-active:', parts: (n: number) => n === 2 },
]

/**
 * Replicas from before the indexes found queues and runs by SCAN and wrote no
 * entries. One pass at boot indexes what is there; every write keeps it since.
 */
export async function backfillRunIndexes(): Promise<void> {
  let cursor = '0'

  do {
    const page = await withRedis((c) => c.scan(cursor, 'MATCH', 'atlas:agentrun-*', 'COUNT', 1_000))

    if (!page) return
    cursor = page[0]
    await withRedis((c) => {
      const write = c.pipeline()

      for (const name of page[1])
        for (const { index, prefix, parts } of INDEXED) {
          const member = name.slice(prefix.length)

          if (name.startsWith(prefix) && parts(member.split(':').length)) write.sadd(index, member)
        }

      return write.exec()
    })
  } while (cursor !== '0')
}

/** One batch of indexed runs; recovery must also work while every desktop is disconnected. */
export async function sweepAbandonedAgentRuns(cursor = '0'): Promise<string> {
  if (!redisEnabled()) return '0'
  const page = await withRedis((redis) => redis.sscan(ACTIVE_RUNS_KEY, cursor, 'COUNT', 200))

  if (!page) return cursor
  for (const member of page[1]) {
    const [userId, ...rest] = member.split(':')
    const sessionId = rest.join(':')

    if (!userId || !sessionId || (await getActiveAgentRunForSession(userId, sessionId))) continue
    // A hash that expired or was deleted without its entry: drop the entry, unless it came back.
    await withRedis((redis) =>
      redis.eval(
        `if redis.call('EXISTS', KEYS[1]) == 0 then return redis.call('SREM', KEYS[2], ARGV[1]) end return 0`,
        2,
        activeRunKey(userId, sessionId),
        ACTIVE_RUNS_KEY,
        member,
      ),
    )
  }

  return page[0]
}
