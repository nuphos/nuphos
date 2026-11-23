// slack_post no longer binds the posting conversation to its root (#4758).
// Rows that option wrote before then stay in the database, so every reader
// must ignore them: no mirror prompt, no blocked transcript sync, no inbound
// routing, and no conflict when the conversation is later picked up in Slack.
import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

type Row = Record<string, unknown>

let rows: Row[] = []

// Enough of Mongo's matcher for the filters these readers send.
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$nor') return !(cond as Row[]).some((sub) => matches(row, sub))
    if (cond && typeof cond === 'object' && '$exists' in cond)
      return (row[key] !== undefined) === (cond as { $exists: boolean }).$exists
    if (cond && typeof cond === 'object' && '$in' in cond)
      return (cond as { $in: unknown[] }).$in.includes(row[key])

    return row[key] === cond
  })
}

useDb({
  db: () => ({
    collection: () => ({
      findOne: (filter: Row) => Promise.resolve(rows.find((row) => matches(row, filter)) ?? null),
      find: (filter: Row) => ({
        toArray: () => Promise.resolve(rows.filter((row) => matches(row, filter))),
      }),
      deleteOne: (filter: Row) => {
        const before = rows.length

        rows = rows.filter((row) => !matches(row, filter))

        return Promise.resolve({ deletedCount: before - rows.length })
      },
      insertOne: (doc: Row) => {
        if (rows.some((row) => row.sessionId === doc.sessionId))
          return Promise.reject(Object.assign(new Error('E11000'), { code: 11000 }))
        rows.push(doc)

        return Promise.resolve({ insertedId: 'id' })
      },
    }),
  }),
})

const { getSlackAgentThread, getSlackAgentThreadBySessionId, getSlackAgentThreadsBySessionIds } =
  await import('./threads')
const { bindSlackAgentThread } = await import('./thread-binding')

const ROOT = { slackWorkspaceId: 'T1', slackChannelId: 'C1', slackThreadTs: '1.0' }
const OWNER = { teamId: 'team-1', agentUserId: 'user-1' }
const legacy = { ...ROOT, ...OWNER, sessionId: 'posting-session', origin: 'agent_notification' }
const fork = {
  ...ROOT,
  ...OWNER,
  slackThreadTs: '2.0',
  sessionId: 'fork-session',
  origin: 'agent_notification',
  notificationContext: 'Alert fired.',
}

beforeEach(() => {
  rows = [{ ...legacy }, { ...fork }]
})

describe('a self-binding left by the removed bindConversation option', () => {
  test('is not the conversation’s Slack thread, so nothing mirrors or blocks', async () => {
    expect(await getSlackAgentThreadBySessionId('posting-session')).toBeNull()
    expect(await getSlackAgentThreadsBySessionIds(['posting-session'])).toEqual([])
  })

  test('does not route replies under its root', async () => {
    expect(await getSlackAgentThread('T1', 'C1', '1.0')).toBeNull()
  })

  test('gives way when the conversation is picked up in Slack', async () => {
    await bindSlackAgentThread({
      ...OWNER,
      slackWorkspaceId: 'T1',
      slackChannelId: 'D1',
      slackThreadTs: '3.0',
      sessionId: 'posting-session',
      origin: 'user_pickup',
    })

    expect(await getSlackAgentThreadBySessionId('posting-session')).toEqual(
      expect.objectContaining({ origin: 'user_pickup', slackChannelId: 'D1' }),
    )
  })

  test('a fork row is still read as before', async () => {
    expect(await getSlackAgentThreadBySessionId('fork-session')).toEqual(
      expect.objectContaining({ notificationContext: 'Alert fired.' }),
    )
    expect(await getSlackAgentThread('T1', 'C1', '2.0')).toEqual(
      expect.objectContaining({ sessionId: 'fork-session' }),
    )
  })
})
