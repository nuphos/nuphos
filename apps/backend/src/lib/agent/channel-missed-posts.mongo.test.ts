// A computer reconnects every few seconds somewhere. What it wakes must read the agents on
// that computer, not every conversation. Against a real MongoDB.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb, db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { useChannelChat } from '@/lib/test/doubles/channel-chat'

import { wakeMissedPosts, wakeOnRuntime } from './channel-missed-posts'
import { setupAgentIndexes } from './db/events'
import { agentConversations, agentMessages } from './db/shared'
import { deliverWaitingAnswersOn, onDevice } from './deliver-waiting-answers'

const TEAM = new ObjectId().toHexString()
const OWNER = new ObjectId().toHexString()
const OTHERS = 300
// Two agents on one other computer, both behind on a channel; the first is being moved.
const MOVING = `${TEAM}-moving`
const WAITING = `${TEAM}-waiting`
const CHANNEL = `${TEAM}-channel`
// On a third computer: an agent on its first Claude Code, one on a second, signed-out one, and
// one on the first in another team, each behind on a channel of its team.
const OTHER_TEAM = new ObjectId().toHexString()
const FIRST = `${TEAM}-first`
const SECOND = `${TEAM}-second`
const ELSEWHERE = `${OTHER_TEAM}-first`
const MINI = `local_${OWNER}_mini`
const MINI_CHANNEL = `${TEAM}-mini-channel`
const OTHER_CHANNEL = `${OTHER_TEAM}-channel`
const woken: string[] = []

useChannelChat({
  notifyAgent: async (_channel, sessionId) => {
    if (sessionId === MOVING)
      throw new AppError(409, 'runtime_moving', 'This conversation is being moved.')
    woken.push(sessionId)
  },
})

/** Documents the server read while `run` ran. */
async function documentsRead(run: () => Promise<unknown>): Promise<number> {
  const scanned = async () =>
    Number((await db().admin().serverStatus()).metrics.queryExecutor.scannedObjects)
  const before = await scanned()

  await run()

  return (await scanned()) - before
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('a computer reconnecting', () => {
  beforeAll(async () => {
    await connectDb()
    await setupAgentIndexes()
    await agentConversations().insertMany(
      Array.from({ length: OTHERS + 2 }, (_, i) => ({
        sessionId: `${TEAM}-${String(i)}`,
        teamId: TEAM,
        userId: OWNER,
        title: 'chat',
        // Two on this computer, one of them in a session of its own; the rest elsewhere.
        runtimeId:
          i === 0
            ? `local_${OWNER}_mac`
            : i === 1
              ? `local_${OWNER}_mac_2`
              : `local_${OWNER}_pc-${String(i)}`,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      })) as never,
    )
    await agentConversations().insertMany([
      ...[MOVING, WAITING].map((sessionId) => ({
        sessionId,
        teamId: TEAM,
        userId: OWNER,
        title: 'agent',
        runtimeId: `local_${OWNER}_box`,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      })),
      {
        sessionId: CHANNEL,
        teamId: TEAM,
        userId: OWNER,
        title: 'channel',
        kind: 'channel',
        agentSessionIds: [MOVING, WAITING],
        agentReadIndex: { [MOVING]: 0, [WAITING]: 0 },
        messageCount: 2,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      },
    ] as never)
    const behind = (sessionId: string, teamId: string, agentSessionIds: string[]) => ({
      sessionId,
      teamId,
      userId: OWNER,
      title: 'channel',
      kind: 'channel',
      agentSessionIds,
      agentReadIndex: Object.fromEntries(agentSessionIds.map((id) => [id, 0])),
      messageCount: 2,
      lastActiveAt: new Date(),
      createdAt: new Date(),
    })

    await agentConversations().insertMany([
      ...(
        [
          [FIRST, TEAM, MINI],
          [SECOND, TEAM, `${MINI}_claude-code_second`],
          [ELSEWHERE, OTHER_TEAM, MINI],
        ] as const
      ).map(([sessionId, teamId, runtimeId]) => ({
        sessionId,
        teamId,
        userId: OWNER,
        title: 'agent',
        runtimeId,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      })),
      behind(MINI_CHANNEL, TEAM, [FIRST, SECOND]),
      behind(OTHER_CHANNEL, OTHER_TEAM, [ELSEWHERE]),
    ] as never)
    // A person's post neither agent got while their computer was away.
    await agentMessages().insertMany(
      [CHANNEL, MINI_CHANNEL, OTHER_CHANNEL].map((sessionId) => ({
        sessionId,
        userId: OWNER,
        messageId: 'missed',
        index: 1,
        role: 'user',
        parts: [{ type: 'text', text: 'Anyone there?' }],
        metadata: {
          version: 1,
          source: 'nuphos',
          sender: { type: 'user', id: OWNER, displayName: 'Ada' },
          sentAt: new Date().toISOString(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      })) as never,
    )
  })
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId: { $in: [TEAM, OTHER_TEAM] } })
    await agentMessages().deleteMany({ sessionId: { $in: [CHANNEL, MINI_CHANNEL, OTHER_CHANNEL] } })
    await closeDb()
  })

  test('finds the agents on that computer and no others', async () => {
    const found = await agentConversations().find(onDevice(OWNER, 'mac')).toArray()

    expect(found.map(({ sessionId }) => sessionId).sort((a, b) => a.localeCompare(b))).toEqual([
      `${TEAM}-0`,
      `${TEAM}-1`,
    ])
  })

  test('reads the agents on that computer, not every conversation', async () => {
    expect(await documentsRead(() => wakeMissedPosts(onDevice(OWNER, 'mac')))).toBeLessThan(10)
    expect(await documentsRead(() => deliverWaitingAnswersOn(onDevice(OWNER, 'mac')))).toBeLessThan(
      10,
    )
  })

  // #4831: one agent being moved stopped the wake for every agent after it.
  test('an agent being moved does not keep the others on its computer from waking', async () => {
    await wakeMissedPosts(onDevice(OWNER, 'box'))

    expect(woken).toEqual([WAITING])
  })

  // A connection to one runtime on a computer woke every agent there, in every team, so each
  // connection to a signed-in Claude Code retried the Bots on a signed-out one.
  test('a runtime answering wakes only its own agents, in its team', async () => {
    woken.length = 0
    await wakeOnRuntime(TEAM, {
      runtimeId: MINI,
      url: 'nuphos-device://runtime',
      authKey: 'transport',
      local: { userId: OWNER, deviceId: 'mini' },
    })

    expect(woken).toEqual([FIRST])
  })
})
