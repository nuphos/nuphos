// The Inbox and channel mentions match a handful of a team's conversations. Against a
// real MongoDB, each must read about that many documents, not the team's whole history.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb, db } from '@/lib/db'

import { listChannelMentions } from './channels'
import { getConversations } from './conversations-list'
import { setupAgentIndexes } from './events'
import { agentConversations } from './shared'

const TEAM = new ObjectId().toHexString()
const VIEWER = new ObjectId().toHexString()
const HISTORY = 300

/** Documents the server read while `run` ran. */
async function documentsRead(run: () => Promise<unknown>): Promise<number> {
  const scanned = async () =>
    Number((await db().admin().serverStatus()).metrics.queryExecutor.scannedObjects)
  const before = await scanned()

  await run()

  return (await scanned()) - before
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('sparse conversation lists', () => {
  beforeAll(async () => {
    await connectDb()
    await setupAgentIndexes()
    await agentConversations().insertMany(
      Array.from({ length: HISTORY }, (_, i) => ({
        sessionId: `${TEAM}-${String(i)}`,
        teamId: TEAM,
        userId: VIEWER,
        title: 'chat',
        lastActiveAt: new Date(Date.now() - i * 60_000),
        createdAt: new Date(Date.now() - i * 60_000),
        // Two of the team's chats wait on a question; the rest answered theirs.
        inputRequests: [{ id: 'q', status: i % 150 === 0 ? 'open' : 'resolved' }],
      })) as never,
    )
  })
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  test('the Inbox reads the chats that wait, not the team history', async () => {
    let found = 0
    const read = await documentsRead(async () => {
      found = (
        await getConversations(VIEWER, {
          teamId: TEAM,
          scope: 'team',
          pendingDecision: true,
          archived: 'exclude',
          limit: 100,
        })
      ).conversations.length
    })

    expect(found).toBe(2)
    expect(read).toBeLessThan(10)
  })

  test('channel mentions read only the channels that mention the viewer', async () => {
    let found = -1
    const read = await documentsRead(async () => {
      found = (await listChannelMentions(TEAM, VIEWER)).length
    })

    expect(found).toBe(0)
    expect(read).toBeLessThan(10)
  })
})
