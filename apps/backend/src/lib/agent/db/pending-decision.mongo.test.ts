// #3753: who may withdraw or correct a question, against a real MongoDB.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { closeDb, connectDb } from '@/lib/db'

import { findInputRequest, updateInputRequest, withdrawInputRequest } from './pending-decision'
import { agentConversations } from './shared'

describe.skipIf(!process.env.TEST_MONGODB_URI)('withdrawing a question on a real database', () => {
  beforeAll(async () => {
    await connectDb()
  })
  afterAll(async () => {
    await closeDb()
  })

  test('the asker and the conversation it is about may withdraw it; only the asker corrects it', async () => {
    const [owner, stranger] = [randomUUID(), randomUUID()]
    const [asker, about, unrelated, strangers] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ]
    const id = `nuphos-${randomUUID()}`

    await agentConversations().insertMany([
      {
        sessionId: asker,
        userId: owner,
        inputRequests: [
          {
            id,
            category: 'approval',
            question: 'Approve the plan?',
            about: [about],
            askedAt: new Date(),
            status: 'open',
          },
        ],
      },
      { sessionId: about, userId: owner },
      { sessionId: unrelated, userId: owner },
      { sessionId: strangers, userId: stranger },
    ] as never[])

    expect(await updateInputRequest(about, owner, id, { question: 'Approve the new plan?' })).toBe(
      false,
    )
    expect(await withdrawInputRequest(unrelated, owner, id)).toBe(false)
    expect(await withdrawInputRequest(about, stranger, id)).toBe(false)
    expect(await withdrawInputRequest(strangers, stranger, id)).toBe(false)
    expect((await findInputRequest(asker, owner, id))?.question).toBe('Approve the plan?')

    expect(await withdrawInputRequest(about, owner, id)).toBe(true)
    expect(await findInputRequest(asker, owner, id)).toBeUndefined()
    expect(await withdrawInputRequest(about, owner, id)).toBe(false)

    await agentConversations().deleteMany({
      sessionId: { $in: [asker, about, unrelated, strangers] },
    })
  })
})
