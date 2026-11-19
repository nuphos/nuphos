// A status check or a finished ask wants a session's newest answer. Against a real
// MongoDB it must read that one message, not a long session's whole transcript.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb, db } from '@/lib/db'

import { getConversationMessages, getLatestAssistantMessage } from './conversations'
import { setupAgentIndexes } from './events'
import { agentMessages } from './shared'

const SESSION = new ObjectId().toHexString()
const OWNER = new ObjectId().toHexString()
const HISTORY = 400
// A tool result of the size a long agent session carries.
const OUTPUT = 'x'.repeat(32 * 1024)

/** Documents the server read while `run` ran. */
async function documentsRead(run: () => Promise<unknown>): Promise<number> {
  const scanned = async () =>
    Number((await db().admin().serverStatus()).metrics.queryExecutor.scannedObjects)
  const before = await scanned()

  await run()

  return (await scanned()) - before
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('latest assistant message', () => {
  beforeAll(async () => {
    await connectDb()
    await setupAgentIndexes()
    await agentMessages().insertMany(
      Array.from({ length: HISTORY }, (_, index) => ({
        sessionId: SESSION,
        userId: OWNER,
        messageId: `m${String(index)}`,
        index,
        // The newest message is a user's, so the answer is one step back.
        role: index % 2 === 0 ? 'user' : 'assistant',
        parts: [
          { type: 'text', text: `message ${String(index)}` },
          { type: 'tool-bash', output: OUTPUT },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      })) as never,
    )
    await agentMessages().insertOne({
      sessionId: SESSION,
      userId: OWNER,
      messageId: 'last',
      index: HISTORY,
      role: 'user',
      parts: [{ type: 'text', text: 'and now?' }],
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })
  afterAll(async () => {
    await agentMessages().deleteMany({ sessionId: SESSION })
    await closeDb()
  })

  test('reads the newest answer alone, where the transcript reads every message', async () => {
    let latest: Awaited<ReturnType<typeof getLatestAssistantMessage>> = null
    const oneRead = await documentsRead(async () => {
      latest = await getLatestAssistantMessage(SESSION, OWNER)
    })
    const fullRead = await documentsRead(() => getConversationMessages(SESSION, OWNER))

    console.log(`documents read: latest answer ${String(oneRead)}, transcript ${String(fullRead)}`)
    expect(latest).toMatchObject({ index: HISTORY - 1, role: 'assistant' })
    expect(fullRead).toBeGreaterThanOrEqual(HISTORY)
    expect(oneRead).toBeLessThanOrEqual(2)
  })
})
