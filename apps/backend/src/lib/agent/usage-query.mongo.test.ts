// GET /teams/:teamId/usage/query against a real MongoDB: grouping, filters, the
// Bot/Task join, and who may see whose usage.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { agentConversations } from './db'
import { agentTokenUsage } from './token-usage'
import { usageNames } from './usage-names'
import { queryTeamUsage } from './usage-query'

import type { UsageQuery } from './usage-query'

const TEAM = new ObjectId().toHexString()
const ADMIN = new ObjectId().toHexString()
const MEMBER = new ObjectId().toHexString()
const BOT = `${TEAM}-bot`
const TASK = `${TEAM}-task`
const OWN = `${TEAM}-own`
const at = new Date('2026-11-17T10:00:00Z')

/** One model call's rows, as the turn recorder writes them. */
function turn(sessionId: string, userId: string, modelId: string, total: number, actor?: string) {
  const base = {
    sessionId,
    userId,
    teamId: TEAM,
    operation: 'agent.turn',
    source: 'agent-runtime' as const,
    accounting: 'upstream_reported' as const,
    provider: 'claude-code',
    modelId,
    createdAt: at,
    ...(actor ? { actorUserId: actor } : {}),
  }
  const row = (kind: 'step_total' | 'input' | 'output', tokens: Record<string, number>) => ({
    ...base,
    recordId: new ObjectId().toHexString(),
    kind,
    tokens,
  })

  return [
    row('step_total', { totalTokens: total }),
    row('input', { inputTokens: total - 10 }),
    row('output', { outputTokens: 10 }),
  ]
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('team usage query', () => {
  beforeAll(async () => {
    await connectDb()
    await agentConversations().insertMany([
      { sessionId: BOT, teamId: TEAM, userId: ADMIN, title: 'Bot', avatar: '05-rembrandt' },
      { sessionId: TASK, teamId: TEAM, userId: ADMIN, title: 'Task', parentSessionId: BOT },
      { sessionId: OWN, teamId: TEAM, userId: MEMBER, title: 'Own' },
    ] as never)
    await agentTokenUsage().insertMany([
      ...turn(BOT, ADMIN, 'opus', 1000, ADMIN),
      ...turn(TASK, ADMIN, 'haiku', 300, ADMIN),
      // A teammate's message in the admin's Bot: the admin's usage, sent by the teammate.
      ...turn(BOT, ADMIN, 'opus', 70, MEMBER),
      // Recorded before senders were: the owner stands in.
      ...turn(OWN, MEMBER, 'opus', 50),
    ])
  })

  afterAll(async () => {
    await agentTokenUsage().deleteMany({ teamId: TEAM })
    await agentConversations().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  const run = async (
    teamRole: 'ADMINISTRATOR' | 'EDITOR',
    query: Partial<UsageQuery>,
    userId = teamRole === 'ADMINISTRATOR' ? ADMIN : MEMBER,
  ) => {
    const rows = await queryTeamUsage(
      TEAM,
      { userId, teamRole },
      {
        from: new Date('2026-11-17T00:00:00Z'),
        to: new Date('2026-11-18T00:00:00Z'),
        groupBy: [],
        filters: {},
        ...query,
      },
    )

    return Object.fromEntries(rows.map((row) => [JSON.stringify(row.keys), row.totalTokens]))
  }

  test('an admin groups the team by sender', async () => {
    expect(await run('ADMINISTRATOR', { groupBy: ['member'] })).toEqual({
      [JSON.stringify({ member: ADMIN })]: 1300,
      [JSON.stringify({ member: MEMBER })]: 120,
    })
  })

  test('a Task counts toward the Bot above it, and a plain chat has no Bot', async () => {
    expect(await run('ADMINISTRATOR', { groupBy: ['bot'] })).toEqual({
      [JSON.stringify({ bot: BOT })]: 1370,
      [JSON.stringify({ bot: null })]: 50,
    })
    expect(
      await run('ADMINISTRATOR', { groupBy: ['task'], filters: { model: ['haiku'] } }),
    ).toEqual({ [JSON.stringify({ task: TASK })]: 300 })
  })

  test('buckets carry their start time', async () => {
    expect(await run('ADMINISTRATOR', { bucket: 'day', groupBy: ['model'] })).toEqual({
      [JSON.stringify({ time: '2026-11-17T00:00:00.000Z', model: 'opus' })]: 1120,
      [JSON.stringify({ time: '2026-11-17T00:00:00.000Z', model: 'haiku' })]: 300,
    })
  })

  test("a member sees only their own conversations, not a teammate's they sent into", async () => {
    expect(await run('EDITOR', { groupBy: ['conversation'] })).toEqual({
      [JSON.stringify({ conversation: OWN })]: 50,
    })
  })

  test('grouped conversations come with their titles, only those the viewer sees', async () => {
    const query = {
      from: new Date('2026-11-17T00:00:00Z'),
      to: new Date('2026-11-18T00:00:00Z'),
      groupBy: ['conversation' as const],
      filters: {},
    }
    const admin = await queryTeamUsage(TEAM, { userId: ADMIN, teamRole: 'ADMINISTRATOR' }, query)
    const member = await queryTeamUsage(TEAM, { userId: MEMBER, teamRole: 'EDITOR' }, query)

    expect(await usageNames(TEAM, ADMIN, ['conversation'], admin)).toEqual({
      conversation: { [BOT]: 'Bot', [TASK]: 'Task', [OWN]: 'Own' },
    })
    expect(await usageNames(TEAM, MEMBER, ['conversation'], member)).toEqual({
      conversation: { [OWN]: 'Own' },
    })
  })

  test("someone else's private conversation is named only as private", async () => {
    const team = `${TEAM}-private`
    const secret = `${team}-secret`
    const query = {
      from: new Date('2026-11-17T00:00:00Z'),
      to: new Date('2026-11-18T00:00:00Z'),
      groupBy: ['conversation' as const],
      filters: {},
    }

    await agentConversations().insertOne({
      sessionId: secret,
      teamId: team,
      userId: MEMBER,
      title: 'Salary review',
      generalAccess: 'none',
    } as never)
    await agentTokenUsage().insertMany(
      turn(secret, MEMBER, 'opus', 10).map((row) => ({ ...row, teamId: team })),
    )
    try {
      const rows = await queryTeamUsage(team, { userId: ADMIN, teamRole: 'ADMINISTRATOR' }, query)

      expect(await usageNames(team, ADMIN, ['conversation'], rows)).toEqual({
        conversation: { [secret]: 'Private session' },
      })
      expect(await usageNames(team, MEMBER, ['conversation'], rows)).toEqual({
        conversation: { [secret]: 'Salary review' },
      })
    } finally {
      await agentTokenUsage().deleteMany({ teamId: team })
      await agentConversations().deleteMany({ teamId: team })
    }
  })

  test("a member's filters cannot reach another member's conversation", async () => {
    expect(await run('EDITOR', { filters: { conversation: [BOT] } })).toEqual({})
  })
})
