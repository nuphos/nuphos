// Who sees whose usage in GET /teams/:teamId/usage, against a real MongoDB.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { agentConversations } from './db'
import { agentTokenUsage } from './token-usage'
import { getTeamUsageSeries } from './usage-summary'

const TEAM = new ObjectId().toHexString()
const ADMIN = new ObjectId().toHexString()
const MEMBER = new ObjectId().toHexString()

/** One turn of `totalTokens` in `userId`'s own conversation. */
function turnRow(userId: string, sessionId: string, totalTokens: number) {
  return {
    recordId: new ObjectId().toHexString(),
    sessionId,
    userId,
    teamId: TEAM,
    operation: 'agent.turn',
    source: 'agent-runtime' as const,
    kind: 'step_total' as const,
    accounting: 'upstream_reported' as const,
    provider: 'claude-code',
    modelId: 'unknown',
    tokens: { totalTokens },
    createdAt: new Date(),
  }
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('team usage visibility', () => {
  beforeAll(async () => {
    await connectDb()
    await agentTokenUsage().insertMany([
      turnRow(ADMIN, `${TEAM}-admin`, 500),
      turnRow(MEMBER, `${TEAM}-member`, 70),
    ])
    await agentConversations().insertMany([
      { sessionId: `${TEAM}-admin`, teamId: TEAM, userId: ADMIN, title: "The admin's chat" },
      { sessionId: `${TEAM}-member`, teamId: TEAM, userId: MEMBER, title: "The member's chat" },
    ] as never)
  })

  afterAll(async () => {
    await agentTokenUsage().deleteMany({ teamId: TEAM })
    await agentConversations().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  const seen = async (userId: string, teamRole: 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER') => {
    const series = await getTeamUsageSeries(TEAM, { userId, teamRole })

    return {
      members: series.days.flatMap((day) => day.members.map((m) => m.userId)).sort(),
      titles: series.sessionsByRange['7d'].map((s) => s.title).sort(),
    }
  }

  test("an admin sees every member's usage and conversations", async () => {
    expect(await seen(ADMIN, 'ADMINISTRATOR')).toEqual({
      members: [ADMIN, MEMBER].sort(),
      titles: ["The admin's chat", "The member's chat"],
    })
  })

  test.each(['EDITOR', 'VIEWER'] as const)(
    '%s sees only their own usage and no one else’s conversation titles',
    async (teamRole) => {
      expect(await seen(MEMBER, teamRole)).toEqual({
        members: [MEMBER],
        titles: ["The member's chat"],
      })
    },
  )
})
