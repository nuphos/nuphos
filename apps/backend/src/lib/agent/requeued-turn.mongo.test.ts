// A busy runtime refuses a Trigger's fire after its turn stored it, and the fire goes
// back to the queue. The runtime's own background work may store a reply meanwhile.
// The retry must still run the fire, once, and record it on its Trigger. A fire a
// turn already ran, delivered again, must not run twice. Against a real MongoDB.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { refusal } from '@/lib/claude-code-preview/runtime-refusal'
import { closeDb, connectDb } from '@/lib/db'

import { setupAgentIndexes } from './db/events'
import { agentConversations, agentMessages } from './db/shared'
import { appendTranscriptMessages } from './db/transcript'
import { systemSender } from './message-metadata'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
  hasPendingUserMessages,
} from './pending-messages'
import { startQueuedTurn } from './queued-turn'
import { agentTriggers } from './trigger-db'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

const SESSION = new ObjectId().toHexString()
const OWNER = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()
const TRIGGER = new ObjectId()

// The user messages of each turn the runtime accepted.
const turns: string[][] = []
let refusals = 0

const store = (messages: { id: string; role: string; parts: unknown[] }[]) =>
  appendTranscriptMessages({
    sessionId: SESSION,
    userId: OWNER,
    teamId: TEAM,
    title: '',
    firstMessage: 'Hourly check',
    messages: messages as never,
    preserveTitle: true,
  })

/** The runtime finished a background segment of its own and stored what it said. */
const backgroundReply = () =>
  store([
    {
      id: new ObjectId().toHexString(),
      role: 'assistant',
      parts: [{ type: 'text', text: 'done' }],
    },
  ])

const fire = () =>
  buildPendingUserMessage({
    renderedText: 'check the deploy',
    source: 'agent.resource',
    actorUserId: OWNER,
    metadata: systemSender(`trigger:${TRIGGER.toHexString()}`, 'Hourly check'),
  })

const lastRunAt = async () => (await agentTriggers().findOne({ _id: TRIGGER }))?.lastRunAt

describe.skipIf(!process.env.TEST_MONGODB_URI)('a fire the runtime refused', () => {
  beforeAll(async () => {
    await connectDb()
    await setupAgentIndexes()
    await agentConversations().insertOne({
      sessionId: SESSION,
      userId: OWNER,
      teamId: TEAM,
      title: 'Hourly check',
      firstMessage: 'Hourly check',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    } as never)
  })
  beforeEach(async () => {
    turns.length = 0
    refusals = 0
    await agentMessages().deleteMany({ sessionId: SESSION })
    await agentTriggers().deleteMany({ _id: TRIGGER })
    await agentTriggers().insertOne({
      _id: TRIGGER,
      teamId: TEAM,
      targetSessionId: SESSION,
      enabled: true,
    } as never)
    installTurnRunner({
      hasActiveAgentRunForSession: async () => false,
      claimAgentRunForSession: async () => () => {},
      runAgentForTrigger: async ({ messages }) => {
        // As the real runner does, the turn stores its input before the runtime answers.
        await store(messages)
        if (refusals > 0) {
          refusals--
          throw refusal('The agent is busy.')
        }
        turns.push(messages.filter((m) => m.role === 'user').map((m) => m.id))

        return { status: 'completed' }
      },
    })
  })
  afterEach(async () => {
    resetTurnRunner()
    await clearPendingUserMessages(OWNER, SESSION)
  })
  afterAll(async () => {
    await agentMessages().deleteMany({ sessionId: SESSION })
    await agentConversations().deleteMany({ sessionId: SESSION })
    await agentTriggers().deleteMany({ _id: TRIGGER })
    await closeDb()
  })

  test('runs once on the retry, after a reply the runtime stored on its own', async () => {
    const message = fire()

    refusals = 1
    await enqueuePendingUserMessage(OWNER, SESSION, message)
    await startQueuedTurn(OWNER, SESSION)
    // Refused: stored, back in the queue, not run.
    expect(turns).toEqual([])
    expect(
      await agentMessages().countDocuments({ sessionId: SESSION, messageId: message.id }),
    ).toBe(1)
    expect(await hasPendingUserMessages(OWNER, SESSION)).toBe(true)

    await backgroundReply()
    await startQueuedTurn(OWNER, SESSION)

    expect(turns).toEqual([[message.id]])
    expect(await lastRunAt()).toBeInstanceOf(Date)
    expect(await hasPendingUserMessages(OWNER, SESSION)).toBe(false)
  })

  test('every message the refused turn took runs on the retry, not only the first', async () => {
    const first = fire()
    const second = fire()

    refusals = 1
    await enqueuePendingUserMessage(OWNER, SESSION, first)
    await enqueuePendingUserMessage(OWNER, SESSION, second)
    await startQueuedTurn(OWNER, SESSION)
    expect(turns).toEqual([])

    await backgroundReply()
    await startQueuedTurn(OWNER, SESSION)

    expect(turns).toEqual([[first.id, second.id]])
    expect(await lastRunAt()).toBeInstanceOf(Date)
    expect(await hasPendingUserMessages(OWNER, SESSION)).toBe(false)
  })

  test('a fire a turn already ran, delivered again, does not run twice', async () => {
    const message = fire()

    await enqueuePendingUserMessage(OWNER, SESSION, message)
    await startQueuedTurn(OWNER, SESSION)
    await backgroundReply()
    expect(turns).toEqual([[message.id]])
    const ranAt = await lastRunAt()

    // A stalled job's second delivery, queued behind the turn that ran it.
    await enqueuePendingUserMessage(OWNER, SESSION, message)
    await startQueuedTurn(OWNER, SESSION)

    expect(turns).toEqual([[message.id]])
    expect(await lastRunAt()).toEqual(ranAt)
    expect(await hasPendingUserMessages(OWNER, SESSION)).toBe(false)
  })
})
