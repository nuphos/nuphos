// Archive lists what Tasks would have: a Bot's work stays with the Bot (#4605).
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { getConversations } from './conversations-list'
import { setupAgentIndexes } from './events'
import { agentConversations } from './shared'

const TEAM = new ObjectId().toHexString()
const ME = new ObjectId().toHexString()
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)
let archived = 0

const row = (name: string, extra: Record<string, unknown> = {}) => ({
  sessionId: `${TEAM}-${name}`,
  teamId: TEAM,
  userId: ME,
  title: name,
  lastActiveAt: minutesAgo(1),
  createdAt: minutesAgo(60),
  ...extra,
})
// Newest first in the archive, in the order they are written here.
const archivedRow = (name: string, extra: Record<string, unknown> = {}) =>
  row(name, { archivedAt: minutesAgo(++archived), ...extra })
const below = (parent: string) => ({ parentSessionId: `${TEAM}-${parent}` })
const archive = async (limit?: number, cursor?: string) =>
  getConversations(ME, { teamId: TEAM, sort: 'archived', limit, cursor })
const names = (rows: { sessionId: string }[]) => rows.map((r) => r.sessionId.slice(TEAM.length + 1))

describe.skipIf(!process.env.TEST_MONGODB_URI)("the archive leaves a Bot's work out", () => {
  beforeAll(async () => {
    await connectDb()
    await setupAgentIndexes()
    await agentConversations().insertMany([
      row('bot', { avatar: '07-ada' }),
      row('bot-chat', { kind: 'channel', avatar: '07-ada', agentSessionIds: [`${TEAM}-bot`] }),
      row('my-task'),
      archivedRow('bot-task', below('bot')),
      archivedRow('bot-task-thread', below('bot-task')),
      archivedRow('my-task-thread', below('my-task')),
      archivedRow('mine'),
      archivedRow('archived-bot', { avatar: '02-leonardo' }),
      archivedRow('archived-bot-task', below('archived-bot')),
      archivedRow('bot-below-bot', { avatar: '03-grace', ...below('bot') }),
      archivedRow('oldest'),
    ] as never)
  })
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  test('it lists my Tasks and Bots, not what a Bot dispatched below it', async () => {
    const { conversations, hasMore } = await archive()

    expect(names(conversations)).toEqual([
      'my-task-thread',
      'mine',
      'archived-bot',
      'bot-below-bot',
      'oldest',
    ])
    expect(hasMore).toBe(false)
    expect(conversations[0]).not.toHaveProperty('ancestors')
  })

  test("a page of a Bot's work does not end the archive early", async () => {
    const first = await archive(2)

    expect(names(first.conversations)).toEqual(['my-task-thread', 'mine'])
    expect(first.hasMore).toBe(true)
    const second = await archive(10, first.nextCursor ?? undefined)

    expect(names(second.conversations)).toEqual(['archived-bot', 'bot-below-bot', 'oldest'])
  })
})
