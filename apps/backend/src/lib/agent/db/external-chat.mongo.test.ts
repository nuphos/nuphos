// A Slack channel is an external chat (#3702): its backing record holds what the Bots read and
// post there, and no person ever sees it in Nuphos. Runs when TEST_MONGODB_URI is set, with
// MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { getConversations } from './conversations-list'
import { agentConversations } from './shared'

const TEAM = new ObjectId().toHexString()
// The Bot's owner, who also owns the record, and a team admin reading the whole team.
const OWNER = new ObjectId().toHexString()
const ADMIN = new ObjectId().toHexString()
const EXTERNAL = `${TEAM}-external`
const now = new Date()
const row = (sessionId: string, extra: Record<string, unknown>) => ({
  sessionId,
  teamId: TEAM,
  userId: OWNER,
  firstMessage: '',
  messageCount: 0,
  createdAt: now,
  lastActiveAt: now,
  ...extra,
})

describe.skipIf(!process.env.TEST_MONGODB_URI)('an external chat', () => {
  beforeAll(async () => {
    await connectDb()
    await agentConversations().insertMany([
      // Readable by the whole team, waiting on a question, and matching the search: listed
      // anywhere it could be, were it not external.
      row(EXTERNAL, {
        kind: 'channel',
        external: 'slack',
        title: 'deploys',
        agentSessionIds: [`${TEAM}-bot`],
        inputRequests: [{ id: 'q', status: 'open' }],
      }),
      // The same, as an ordinary chat: what the listings below do show.
      row(`${TEAM}-chat`, {
        kind: 'channel',
        title: 'deploys',
        participantIds: [ADMIN],
        inputRequests: [{ id: 'q', status: 'open' }],
      }),
      row(`${TEAM}-bot`, { title: 'deploys Bot', avatar: '07-ada' }),
      // A Task under the external chat, as if one had been opened there.
      row(`${TEAM}-task`, { title: 'deploys task', parentSessionId: EXTERNAL }),
    ] as never)
  })
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  test('is never listed, searched, in the Inbox or a parent, for its owner or an admin', async () => {
    const listed: string[] = []
    const shown: string[] = []

    for (const viewer of [OWNER, ADMIN])
      for (const scope of ['mine', 'team', 'shared'] as const)
        for (const options of [
          {},
          { channels: true },
          { search: 'deploys' },
          { search: 'deploys', channels: true },
          { pendingDecision: true },
          { pendingDecision: true, channels: true },
          { pendingDecision: true, includeOnboarding: true, channels: true },
          { bots: true },
          { withParents: true },
          { archived: 'exclude' as const, channels: true },
        ]) {
          const { conversations, parents } = await getConversations(viewer, {
            teamId: TEAM,
            scope,
            limit: 100,
            ...options,
          })

          for (const { sessionId } of [...conversations, ...parents]) {
            listed.push(
              `${viewer === OWNER ? 'owner' : 'admin'} ${scope} ${JSON.stringify(options)}`,
            )
            if (sessionId === EXTERNAL) shown.push(listed.at(-1)!)
          }
        }

    expect(shown).toEqual([])
    // The listings themselves work: the ordinary chat and the Task are there.
    expect(listed.length).toBeGreaterThan(0)
    expect(
      (
        await getConversations(ADMIN, {
          teamId: TEAM,
          scope: 'team',
          search: 'deploys',
          channels: true,
        })
      ).conversations.map((conversation) => conversation.sessionId),
    ).toEqual([`${TEAM}-chat`])
  })
})
