// GET /teams/:teamId/usage/query against a real MongoDB: grouping, filters, the
// Bot/Task join, and who may see whose usage.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { agentConversations } from './db'
import { agentTokenUsage } from './token-usage'
import { usageNames } from './usage-names'
import { OTHERS_PRIVATE, queryTeamUsage } from './usage-query'

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
    const rows = await queryTeamUsage(TEAM, {
      ...day,
      groupBy: [],
      filters: {},
      viewerId: ADMIN,
      ...query,
    })

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
      await queryTeamUsage(team, {
        ...day,
        groupBy: ['conversation'],
        filters: {},
        viewerId: userId,
      }),
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
    expect(await run({ groupBy: ['conversation'], filters: { model: ['haiku'] } })).toEqual({
      [JSON.stringify({ conversation: TASK })]: 300,
    })
    // What a released Desktop still asks for: the same grouping, under its own key.
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
    const grouped = async (viewerId: string) =>
      (
        await queryTeamUsage(team, { ...day, groupBy: ['conversation'], filters: {}, viewerId })
      ).map((row) => row.keys)

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
      expect(await grouped(ADMIN)).toEqual([{ conversation: OTHERS_PRIVATE }])
      expect(await grouped(MEMBER)).toEqual([{ conversation: secret }])
      expect(await named(team, MEMBER, 'EDITOR')).toEqual({
        conversation: { [secret]: 'Salary review' },
      })
    } finally {
      await agentTokenUsage().deleteMany({ teamId: team })
      await agentConversations().deleteMany({ teamId: team })
    }
  })

  test('grouped by Bot or by conversation, the same usage adds up the same, private included', async () => {
    const team = `${TEAM}-groupings`
    const bot = `${team}-bot`
    const privateTask = `${team}-private-task`
    const privateChat = `${team}-private-chat`
    const chat = `${team}-chat`
    const totals = async (dimension: 'bot' | 'conversation') =>
      Object.fromEntries(
        (
          await queryTeamUsage(team, { ...day, groupBy: [dimension], filters: {}, viewerId: ADMIN })
        ).map((row) => [String(row.keys[dimension]), row.totalTokens]),
      )

    await agentConversations().insertMany([
      { sessionId: bot, teamId: team, userId: ADMIN, title: 'Bot', avatar: '05-rembrandt' },
      // A teammate's private Task under the admin's Bot, and a private chat in no Bot.
      {
        sessionId: privateTask,
        teamId: team,
        userId: MEMBER,
        title: 'Private task',
        parentSessionId: bot,
        generalAccess: 'none',
      },
      {
        sessionId: privateChat,
        teamId: team,
        userId: MEMBER,
        title: 'Mine',
        generalAccess: 'none',
      },
      { sessionId: chat, teamId: team, userId: ADMIN, title: 'Chat' },
    ] as never)
    await agentTokenUsage().insertMany(
      [
        ...turn(bot, ADMIN, 'opus', 1000),
        ...turn(privateTask, MEMBER, 'opus', 200),
        ...turn(privateChat, MEMBER, 'opus', 30),
        ...turn(chat, ADMIN, 'opus', 4),
      ].map((row) => ({ ...row, teamId: team })),
    )
    try {
      const byBot = await totals('bot')
      const byConversation = await totals('conversation')
      const sum = (rows: Record<string, number>) =>
        Object.values(rows).reduce((total, value) => total + value, 0)

      expect(sum(byBot)).toBe(sum(byConversation))
      // Other members' private usage is the same in both, never a Bot's or "not recorded".
      expect(byBot[OTHERS_PRIVATE]).toBe(230)
      expect(byConversation[OTHERS_PRIVATE]).toBe(230)
      expect(byBot).toEqual({ [bot]: 1000, [OTHERS_PRIVATE]: 230, null: 4 })
    } finally {
      await agentTokenUsage().deleteMany({ teamId: team })
      await agentConversations().deleteMany({ teamId: team })
    }
  })

  test('a group with any model that has no list price has no cost, never a partial one', async () => {
    const team = `${TEAM}-prices`

    await agentTokenUsage().insertMany(
      [
        ...turn(`${team}-a`, ADMIN, 'claude-opus-5-5', 1_000_000),
        ...turn(`${team}-a`, ADMIN, 'gpt-6.1-sol', 1_000_000),
      ].map((row) => ({ ...row, teamId: team })),
    )
    try {
      const [row] = await queryTeamUsage(team, {
        ...day,
        groupBy: ['member'],
        filters: {},
        viewerId: ADMIN,
      })

      expect(row?.totalTokens).toBe(2_000_000)
      expect(row?.costUsd).toBeUndefined()
    } finally {
      await agentTokenUsage().deleteMany({ teamId: team })
    }
  })
})
