// #3470 against a real MongoDB: the fake in archive.test.ts reads the $pull's operator
// shape back, so only the database itself shows what `$not: { $elemMatch }` inside a
// $pull on sub-documents removes. Runs when TEST_MONGODB_URI is set.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { archiveIdleConversations } from '@/lib/agent/conversation-auto-archive'
import { closeDb, connectDb } from '@/lib/db'

import { setConversationArchived } from './archive'
import { leaveChats } from './bot-membership'
import { agentConversations } from './shared'

const teamId = randomUUID()
const userId = randomUUID()
const thread = randomUUID()
const parent = randomUUID()
const idle = randomUUID()
const bot = randomUUID()
const chat = randomUUID()
const question = (id: string, about?: string[]) => ({
  id,
  category: 'preference' as const,
  question: id,
  askedAt: new Date(),
  status: 'open' as const,
  ...(about ? { about } : {}),
})
const seed = (sessionId: string, fields = {}) =>
  agentConversations().insertOne({
    sessionId,
    teamId,
    userId,
    title: sessionId,
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...fields,
  } as never)

describe.skipIf(!process.env.TEST_MONGODB_URI)('archiving withdraws questions about it', () => {
  beforeAll(() => connectDb())
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId })
    await closeDb()
  })

  test('only a question about archived conversations alone is withdrawn', async () => {
    await seed(parent, {
      inputRequests: [
        question('thread-only', [thread]),
        question('thread-and-pr', [thread, 'github/1/2/3']),
        question('empty-about', []),
        question('no-about'),
      ],
    })
    await seed(thread, { parentSessionId: parent })

    await setConversationArchived(thread, true)
    const kept = await agentConversations().findOne({ sessionId: parent })

    expect(kept?.inputRequests?.map((request) => request.id)).toEqual([
      'thread-and-pr',
      'empty-about',
      'no-about',
    ])
  })
  // #3760: archived by idleness or by a Bot leaving its chats, not by setConversationArchived.
  test('an idle Task archived by the sweep takes the questions about it along', async () => {
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

    await seed(idle, { parentSessionId: parent, lastActiveAt: longAgo })
    await agentConversations().updateOne(
      { sessionId: parent },
      { $push: { inputRequests: question('idle-only', [idle]) } },
    )

    await archiveIdleConversations()
    const kept = await agentConversations().findOne({ sessionId: parent })

    expect((await agentConversations().findOne({ sessionId: idle }))?.archivedAt).toBeDefined()
    expect(kept?.inputRequests?.map((request) => request.id)).not.toContain('idle-only')
  })

  test('a Bot made a Task again takes the questions about its chat along', async () => {
    await seed(bot, {
      avatar: { emoji: 'x' },
      messageCount: 1,
      inputRequests: [question('chat-only', [chat])],
    })
    await seed(chat, { kind: 'channel', agentSessionIds: [bot], participantIds: [userId] })

    await leaveChats(bot)
    const kept = await agentConversations().findOne({ sessionId: bot })

    expect((await agentConversations().findOne({ sessionId: chat }))?.archivedAt).toBeDefined()
    expect(kept?.inputRequests ?? []).toEqual([])
  })
})
