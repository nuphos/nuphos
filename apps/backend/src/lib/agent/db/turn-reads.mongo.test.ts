// A turn on a long session reads its recent history and appends what it adds.
// Against a real MongoDB, neither may read the whole transcript, and appending
// a recent window must leave every older message in place.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb, db } from '@/lib/db'

import { storedTranscriptTail } from '@/routes/agent/transcript-tail'

import { readTurnHistory } from '../turn-history'
import { setupAgentIndexes } from './events'
import { agentConversations, agentMessages } from './shared'
import { appendTranscriptMessages } from './transcript'

const SESSION = new ObjectId().toHexString()
const OWNER = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()
const HISTORY = 20_000
// A turn reads its window plus a handful of targeted lookups.
const BOUND = 400

/** Documents the server read while `run` ran. */
async function documentsRead(run: () => Promise<unknown>): Promise<number> {
  const scanned = async () =>
    Number((await db().admin().serverStatus()).metrics.queryExecutor.scannedObjects)
  const before = await scanned()

  await run()

  return (await scanned()) - before
}

const text = (value: string) => [{ type: 'text', text: value }]

describe.skipIf(!process.env.TEST_MONGODB_URI)('a turn on a long session', () => {
  beforeAll(async () => {
    await connectDb()
    await setupAgentIndexes()
    await agentConversations().insertOne({
      sessionId: SESSION,
      userId: OWNER,
      teamId: TEAM,
      title: 'long',
      firstMessage: 'message 0',
      messageCount: HISTORY,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    } as never)
    for (let start = 0; start < HISTORY; start += 5_000)
      await agentMessages().insertMany(
        Array.from({ length: 5_000 }, (_, offset) => {
          const index = start + offset

          return {
            sessionId: SESSION,
            userId: OWNER,
            messageId: `m${String(index)}`,
            index,
            role: index % 2 === 0 ? 'user' : 'assistant',
            parts: text(`message ${String(index)}`),
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        }) as never,
      )
  })
  afterAll(async () => {
    await agentMessages().deleteMany({ sessionId: SESSION })
    await agentConversations().deleteMany({ sessionId: SESSION })
    await closeDb()
  })

  test('reads a bounded tail of the history, and knows what was answered', async () => {
    let history: Awaited<ReturnType<typeof readTurnHistory>> = null
    const read = await documentsRead(async () => {
      history = await readTurnHistory(
        { targetSessionId: SESSION, userId: OWNER, teamId: TEAM },
        // One answered long ago, one not yet stored.
        [{ id: 'm10' }, { id: 'new' }] as never,
        'agent.thread',
      )
    })

    console.log(`documents read for a ${String(HISTORY)}-message turn history: ${String(read)}`)
    expect(read).toBeLessThanOrEqual(BOUND)
    expect(history!.messages.at(-1)?.messageId).toBe(`m${String(HISTORY - 1)}`)
    expect([...history!.answered]).toEqual(['m10'])
  })

  test('appends a recent window after every stored message and drops none', async () => {
    const recent = (
      await agentMessages().find({ sessionId: SESSION }).sort({ index: -1 }).limit(3).toArray()
    )
      .reverse()
      .map((message) => ({ id: message.messageId, role: message.role, parts: message.parts }))
    let count = 0
    const read = await documentsRead(async () => {
      ;({ count } = await appendTranscriptMessages({
        sessionId: SESSION,
        userId: OWNER,
        teamId: TEAM,
        title: '',
        firstMessage: 'a window starts mid-conversation',
        messages: [...recent, { id: 'next', role: 'user', parts: text('next') }],
        preserveTitle: true,
      }))
    })

    console.log(`documents read for a ${String(HISTORY)}-message append: ${String(read)}`)
    expect(read).toBeLessThanOrEqual(BOUND)
    expect(count).toBe(HISTORY + 1)
    expect(await agentMessages().countDocuments({ sessionId: SESSION })).toBe(HISTORY + 1)
    expect(await agentMessages().findOne({ sessionId: SESSION, messageId: 'next' })).toMatchObject({
      index: HISTORY,
    })
    for (const index of [0, HISTORY / 2])
      expect(
        await agentMessages().findOne({ sessionId: SESSION, messageId: `m${String(index)}` }),
      ).toMatchObject({ index, parts: text(`message ${String(index)}`) })
    expect(await agentConversations().findOne({ sessionId: SESSION })).toMatchObject({
      firstMessage: 'message 0',
      messageCount: HISTORY + 1,
    })
  })

  test("a turn's reply with tool calls keeps their runtime results, read from the recent messages", async () => {
    // The runtime reported this turn's tool call as failed while the turn ran.
    await agentMessages().insertOne({
      sessionId: SESSION,
      userId: OWNER,
      messageId: 'runtime-report',
      index: HISTORY + 1,
      role: 'assistant',
      parts: [
        {
          type: 'tool-bash',
          toolCallId: 'call-1',
          runtimeResult: true,
          state: 'output-error',
          errorText: 'killed',
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    const read = await documentsRead(() =>
      appendTranscriptMessages({
        sessionId: SESSION,
        userId: OWNER,
        teamId: TEAM,
        title: '',
        firstMessage: 'next',
        messages: [
          {
            id: 'reply',
            role: 'assistant',
            parts: [{ type: 'tool-bash', toolCallId: 'call-1', state: 'output-available' }],
          },
        ],
        preserveTitle: true,
      }),
    )

    console.log(
      `documents read for a ${String(HISTORY)}-message append with a tool call: ${String(read)}`,
    )
    expect(read).toBeLessThanOrEqual(BOUND)
    expect(await agentMessages().findOne({ sessionId: SESSION, messageId: 'reply' })).toMatchObject(
      {
        index: HISTORY + 2,
        parts: [expect.objectContaining({ toolCallId: 'call-1', state: 'output-error' })],
      },
    )
  })

  test("builds the finished turn's transcript tail from the recent window", async () => {
    const count = await agentMessages().countDocuments({ sessionId: SESSION })
    let frame: Record<string, unknown> = {}
    const read = await documentsRead(async () => {
      frame = await storedTranscriptTail(SESSION, OWNER, TEAM, count, 1)
    })

    console.log(`documents read for a ${String(count)}-message transcript tail: ${String(read)}`)
    expect(read).toBeLessThanOrEqual(BOUND)
    // The turn's own message is the newest, the reply. Its input is the user's 'next',
    // stored before the runtime's report.
    expect(frame).toMatchObject({ type: 'atlas-transcript-tail', messagesFirstIndex: count - 3 })
  })
})
