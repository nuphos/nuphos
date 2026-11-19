import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { closeDb, connectDb } from '@/lib/db'

import {
  bumpConversationActivity,
  conversationReadState,
  countUnreadConversations,
} from './read-state'
import { agentConversations } from './shared'

const teamId = randomUUID()
const userId = randomUUID()
const id = (name: string) => `${teamId}-${name}`
const seed = (name: string, fields = {}) =>
  agentConversations().insertOne({
    sessionId: id(name),
    teamId,
    userId,
    watcherIds: [userId],
    title: name,
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...fields,
  } as never)
const state = async (name: string) =>
  conversationReadState((await agentConversations().findOne({ sessionId: id(name) }))!)

// #3329: a Bot's row showed a second dot for a Task under it.
describe.skipIf(!process.env.TEST_MONGODB_URI)('a Task under a Bot has no unread state', () => {
  beforeAll(async () => {
    await connectDb()
    await seed('bot', { avatar: '07-ada' })
    // Its reply from before this rule is still unread; the next turn reads it too.
    await seed('kid', { parentSessionId: id('bot'), activitySeq: 2, readSeq: 1 })
    await seed('nested-bot', { parentSessionId: id('bot'), avatar: '05-rembrandt' })
    await seed('lead')
    await seed('lead-kid', { parentSessionId: id('lead') })
  })
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId })
    await closeDb()
  })

  test("its turns are activity, read as they happen; everyone else's stay unread", async () => {
    for (const name of ['bot', 'kid', 'nested-bot', 'lead-kid'])
      await bumpConversationActivity(id(name), userId)

    expect(await state('kid')).toEqual({ activitySeq: 3, readSeq: 3, unread: false })
    for (const name of ['bot', 'nested-bot', 'lead-kid'])
      expect((await state(name)).unread).toBe(true)
    // The badge counts the Bot, the Bot it nested and the ordinary Task's Task.
    expect(await countUnreadConversations(userId, teamId)).toBe(3)
  })
})
