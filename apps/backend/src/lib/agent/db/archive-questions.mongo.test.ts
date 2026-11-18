// #3470 against a real MongoDB: the fake in archive.test.ts reads the $pull's operator
// shape back, so only the database itself shows what `$not: { $elemMatch }` inside a
// $pull on sub-documents removes. Runs when TEST_MONGODB_URI is set.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { closeDb, connectDb } from '@/lib/db'

import { setConversationArchived } from './archive'
import { agentConversations } from './shared'

const teamId = randomUUID()
const userId = randomUUID()
const thread = randomUUID()
const parent = randomUUID()
const question = (id: string, about?: string[]) => ({
  id,
  category: 'preference',
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
})
