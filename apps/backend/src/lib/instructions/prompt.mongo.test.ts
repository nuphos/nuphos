import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db/shared'
import { closeDb, connectDb } from '@/lib/db'

import { instructionsUpdate } from './prompt'

const teamId = new ObjectId().toHexString()
const sessionId = randomUUID()
const turn = () => instructionsUpdate(teamId, randomUUID(), sessionId, false)
const edit = (instructions: string) =>
  agentConversations().updateOne({ sessionId }, { $set: { instructions } })

describe.skipIf(!process.env.TEST_MONGODB_URI)('recorded standing instructions', () => {
  beforeAll(async () => {
    await connectDb()
    await agentConversations().insertOne({
      sessionId,
      teamId,
      userId: 'owner',
      avatar: '07-ada',
      title: 'Release Helper',
      instructions: 'Ship on Fridays.',
      firstMessage: '',
      messageCount: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    })
  })
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId })
    await closeDb()
  })

  test('an edit reaches the next accepted turn once, and an unaccepted one keeps it', async () => {
    // A conversation from before digests were recorded is not told anything.
    const legacy = await turn()

    expect(legacy.text).toBe('')
    await legacy.given()

    expect((await turn()).text).toBe('')
    await edit('Ship on Mondays.')
    const refused = await turn()

    expect(refused.text).toContain('Ship on Mondays.')
    const accepted = await turn()

    expect(accepted.text).toContain('Ship on Mondays.')
    await accepted.given()
    expect((await turn()).text).toBe('')
  })

  test("another team's digest is never written", async () => {
    await edit('Ship on Tuesdays.')
    const other = await instructionsUpdate(new ObjectId().toHexString(), 'u', sessionId, false)

    await other.given()
    expect((await turn()).text).toContain('Ship on Tuesdays.')
  })
})
