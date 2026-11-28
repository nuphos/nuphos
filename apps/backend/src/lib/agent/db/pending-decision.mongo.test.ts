// #3753: who may withdraw or correct a question, against a real MongoDB.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { closeDb, connectDb } from '@/lib/db'

import { findInputRequest, updateInputRequest, withdrawInputRequest } from './pending-decision'
import { markDesktopTakenOver } from './desktop-takeover'
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

  test('a takeover is stamped once, on the open computer card for that display only', async () => {
    const [owner, session] = [randomUUID(), randomUUID()]
    const request = (id: string, display: number, category = 'computer') => ({
      id,
      category,
      question: 'Sign in',
      desktop: { deviceId: 'dev-1', display, title: 'Box · :1' },
      askedAt: new Date(),
      status: 'open',
    })

    await agentConversations().insertOne({
      sessionId: session,
      userId: owner,
      inputRequests: [request('a', 1), request('b', 2), request('c', 1, 'approval')],
    } as never)

    await markDesktopTakenOver(session, 1, new Date(1_000))
    await markDesktopTakenOver(session, 1, new Date(9_000))
    const taken = (id: string) => findInputRequest(session, owner, id).then((r) => r?.takenOverAt)

    expect(await taken('a')).toEqual(new Date(1_000))
    expect(await taken('b')).toBeUndefined()
    expect(await taken('c')).toBeUndefined()

    await agentConversations().deleteMany({ sessionId: session })
  })
})
