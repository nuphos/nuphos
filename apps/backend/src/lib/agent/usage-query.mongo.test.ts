// GET /teams/:teamId/usage/query against a real MongoDB: grouping, filters, the
// Bot/Task join, and who may see whose usage.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { agentConversations } from './db'
import { agentTokenUsage } from './token-usage'
import { OTHERS_PRIVATE, mergeOthersPrivate, usageNames } from './usage-names'
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

  const day = { from: new Date('2026-11-17T00:00:00Z'), to: new Date('2026-11-18T00:00:00Z') }
  const run = async (query: Partial<UsageQuery>) => {
    const rows = await queryTeamUsage(TEAM, { ...day, groupBy: [], filters: {}, ...query })

    return Object.fromEntries(rows.map((row) => [JSON.stringify(row.keys), row.totalTokens]))
  }
  const named = async (
    team: string,
    userId: string,
    teamRole: 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER',
  ) =>
    usageNames(
      team,
      { userId, teamRole },
      ['conversation'],
      await queryTeamUsage(team, { ...day, groupBy: ['conversation'], filters: {} }),
    )

  test('the team is grouped by sender', async () => {
    expect(await run({ groupBy: ['member'] })).toEqual({
      [JSON.stringify({ member: ADMIN })]: 1300,
      [JSON.stringify({ member: MEMBER })]: 120,
    })
  })

  test('a Task counts toward the Bot above it, and a plain chat has no Bot', async () => {
    expect(await run({ groupBy: ['bot'] })).toEqual({
      [JSON.stringify({ bot: BOT })]: 1370,
      [JSON.stringify({ bot: null })]: 50,
    })
    expect(await run({ groupBy: ['task'], filters: { model: ['haiku'] } })).toEqual({
      [JSON.stringify({ task: TASK })]: 300,
    })
  })

  test('buckets carry their start time', async () => {
    expect(await run({ bucket: 'day', groupBy: ['model'] })).toEqual({
      [JSON.stringify({ time: '2026-11-17T00:00:00.000Z', model: 'opus' })]: 1120,
      [JSON.stringify({ time: '2026-11-17T00:00:00.000Z', model: 'haiku' })]: 300,
    })
  })

  test('an administrator sees every conversation’s name', async () => {
    expect(await named(TEAM, ADMIN, 'ADMINISTRATOR')).toEqual({
      conversation: { [BOT]: 'Bot', [TASK]: 'Task', [OWN]: 'Own' },
    })
  })

  test.each(['EDITOR', 'VIEWER'] as const)(
    'a member with %s sees the team’s numbers, but only their own conversations’ names',
    async (teamRole) => {
      expect(await named(TEAM, MEMBER, teamRole)).toEqual({
        conversation: { [BOT]: null, [TASK]: null, [OWN]: 'Own' },
      })
    },
  )

  test('a conversation its owner made private is one merged row to others, and itself to its owner', async () => {
    const team = `${TEAM}-private`
    const secret = `${team}-secret`
    const grouped = async (userId: string, teamRole: 'ADMINISTRATOR' | 'EDITOR') =>
      mergeOthersPrivate(
        team,
        { userId, teamRole },
        ['conversation'],
        await queryTeamUsage(team, { ...day, groupBy: ['conversation'], filters: {} }),
      )

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
      expect((await grouped(ADMIN, 'ADMINISTRATOR')).map((row) => row.keys)).toEqual([
        { conversation: OTHERS_PRIVATE },
      ])
      expect((await grouped(MEMBER, 'EDITOR')).map((row) => row.keys)).toEqual([
        { conversation: secret },
      ])
      expect(await named(team, MEMBER, 'EDITOR')).toEqual({
        conversation: { [secret]: 'Salary review' },
      })
    } finally {
      await agentTokenUsage().deleteMany({ teamId: team })
      await agentConversations().deleteMany({ teamId: team })
    }
  })
})
