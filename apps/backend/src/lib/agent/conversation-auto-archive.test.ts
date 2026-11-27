import { describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useRedis } from '@/lib/test/doubles/redis'

import {
  idleConversationFilter,
  nextSweepDelay,
  sweepOnOneReplica,
} from './conversation-auto-archive'

let archives = 0

useAgentDb({
  agentConversations: (() => ({
    updateMany: async () => {
      archives += 1

      return { modifiedCount: 0 }
    },
    find: () => ({ toArray: async () => [] }),
  })) as never,
})

// Redis SET NX PX, shared by every replica in the test.
const claims = new Map<string, string>()

useRedis({
  redisEnabled: () => true,
  withRedis: (op) =>
    op({
      set: async (key: string, value: string) => {
        await Promise.resolve()
        if (claims.has(key)) return null
        claims.set(key, value)

        return 'OK'
      },
    } as never) as never,
})

describe('idleConversationFilter', () => {
  const now = new Date('2026-09-11T12:00:00.000Z')

  test('targets unarchived Tasks, and Bots nobody wrote to, idle past the cutoff, honouring a manual restore', () => {
    const cutoff = new Date('2026-09-04T12:00:00.000Z')

    expect(idleConversationFilter(now, 7)).toEqual({
      archivedAt: { $exists: false },
      lastActiveAt: { $lt: cutoff },
      $and: [
        { $or: [{ avatar: { $exists: false } }, { messageCount: 0 }] },
        {
          $or: [{ archiveRestoredAt: { $exists: false } }, { archiveRestoredAt: { $lt: cutoff } }],
        },
      ],
    })
  })
})

describe('sweepOnOneReplica', () => {
  test('two replicas ticking together sweep once', async () => {
    archives = 0
    claims.clear()
    await Promise.all([sweepOnOneReplica(), sweepOnOneReplica()])
    expect(archives).toBe(1)
    // The next hour, once the claim has expired, sweeps again.
    claims.clear()
    await sweepOnOneReplica()
    expect(archives).toBe(2)
  })

  // A deploy starts replicas while the claim of one that is gone still holds; ticking again
  // only an hour later left 1 h 50 min between two sweeps.
  test('a replica refused the hour asks again a minute later, not an hour later', async () => {
    claims.clear()
    expect(await sweepOnOneReplica()).toBe(true)
    expect(await sweepOnOneReplica()).toBe(false)
    expect(nextSweepDelay(false)).toBe(60_000)
    expect(nextSweepDelay(true)).toBe(60 * 60_000)
  })
})
