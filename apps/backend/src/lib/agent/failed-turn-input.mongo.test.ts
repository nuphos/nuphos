// A turn whose reply kept nothing to show, because it failed or because the agent
// only read and said nothing, still stores its input and that reply. The next wake
// must answer its own message, not that input again: otherwise each such turn adds
// one more copy to every later prompt until none fits.
// Against a real MongoDB.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'
import { errorHandler } from '@/lib/errors'
import { registerAdminAgentRoutes } from '@/routes/admin/agent'
import { turnInputMessages } from '@/routes/agent/turn-start-frame'
import { buildMessagesForLarkTurn } from '@/routes/lark/transcript'
import { buildMessagesForRenderedTurn } from '@/routes/slack/messages'

import { setupAgentIndexes } from './db/events'
import { agentConversations, agentMessages } from './db/shared'
import { appendTranscriptMessages } from './db/transcript'
import { systemSender } from './message-metadata'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from './pending-messages'
import { startQueuedTurn } from './queued-turn'
import { claimAgentRunForSession } from './run-admission'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AdminVars } from '@/routes/admin/auth'

const SESSION = new ObjectId().toHexString()
const OWNER = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()

// The input of each turn the runner was asked to run.
const inputs: string[][] = []
// What each turn's reply keeps.
let replyParts: unknown[] = []

const store = (messages: { id: string; role: string; parts: unknown[] }[]) =>
  appendTranscriptMessages({
    sessionId: SESSION,
    userId: OWNER,
    teamId: TEAM,
    title: '',
    firstMessage: 'Watcher',
    messages: messages as never,
    preserveTitle: true,
  })

const wake = () =>
  buildPendingUserMessage({
    renderedText: 'something was posted',
    source: 'agent.resource',
    actorUserId: OWNER,
    metadata: systemSender('nuphos', 'Nuphos'),
  })

// A turn that failed: its input, then a reply that kept nothing.
const failedTurn = () => {
  const input = new ObjectId().toHexString()

  return {
    input,
    stored: [
      { id: input, role: 'user', parts: [{ type: 'text', text: 'posted' }] },
      {
        id: new ObjectId().toHexString(),
        role: 'assistant',
        parts: [{ type: 'turn-interrupted', id: 'x', reason: 'error', message: 'failed' }],
      },
    ],
  }
}

describe.skipIf(!process.env.TEST_MONGODB_URI)(
  'a turn after ones whose replies kept nothing',
  () => {
    beforeAll(async () => {
      await connectDb()
      await setupAgentIndexes()
      await agentConversations().insertOne({
        sessionId: SESSION,
        userId: OWNER,
        teamId: TEAM,
        title: 'Watcher',
        firstMessage: 'Watcher',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      } as never)
    })
    beforeEach(async () => {
      inputs.length = 0
      await agentMessages().deleteMany({ sessionId: SESSION })
      installTurnRunner({
        hasActiveAgentRunForSession: async () => false,
        claimAgentRunForSession: async () => () => {},
        runAgentForTrigger: async ({ messages }) => {
          inputs.push(turnInputMessages(messages).map((m) => m.id))
          // As the real runner stores a turn: its input, then the reply.
          await store([
            ...messages.slice(-1),
            { id: new ObjectId().toHexString(), role: 'assistant', parts: replyParts },
          ])

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
      await closeDb()
    })

    test.each([
      ['failed', [{ type: 'turn-interrupted', id: 'x', reason: 'error', message: 'failed' }]],
      ['said nothing', []],
    ])('answers only its own message, however many before it %s', async (_, parts) => {
      replyParts = parts
      const wakes = [wake(), wake(), wake()]

      for (const message of wakes) {
        await enqueuePendingUserMessage(OWNER, SESSION, message)
        await startQueuedTurn(OWNER, SESSION)
      }

      expect(inputs).toEqual(wakes.map((message) => [message.id]))
    })

    // Slack and Lark rebuild the history of their turns themselves.
    test('a Slack turn after a failed one answers only its own message', async () => {
      const { stored } = failedTurn()

      await store(stored)
      const messages = await buildMessagesForRenderedTurn({
        sessionId: SESSION,
        userId: OWNER,
        teamId: TEAM,
        messageId: 'slack-next',
        renderedText: 'next',
      })

      expect(turnInputMessages(messages).map((m) => m.id)).toEqual(['slack-next'])
    })

    test('a Lark turn after a failed one answers only its own message', async () => {
      const { stored } = failedTurn()

      await store(stored)
      const messages = await buildMessagesForLarkTurn({
        sessionId: SESSION,
        userId: OWNER,
        teamId: TEAM,
        renderedText: 'next',
        metadata: systemSender('nuphos', 'Nuphos'),
        carried: [],
      })

      expect(turnInputMessages(messages).map((m) => m.id)).toEqual([messages.at(-1)!.id])
    })

    test('an admin rewake still finds the input of a failed last turn pending', async () => {
      const { stored } = failedTurn()

      await store(stored)
      const admin = new Hono<{ Variables: AdminVars }>()

      admin.onError(errorHandler)
      registerAdminAgentRoutes(admin)
      // A run already holds the session, so rewake stops right after deciding
      // there is a pending turn, without starting one.
      const release = await claimAgentRunForSession(OWNER, SESSION)
      const response = await admin.request(`/agent/conversations/${SESSION}/rewake`, {
        method: 'POST',
      })

      release?.()
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'run_in_flight',
      )
    })

    test('a conversation stored before this fix answers only its next message', async () => {
      // As a stuck conversation is stored: wakes whose replies kept nothing, the
      // last ones refused as too large. Nothing in it is rewritten to recover.
      const stuck = Array.from({ length: 40 }, (_, n) => [
        {
          id: new ObjectId().toHexString(),
          role: 'user',
          parts: [{ type: 'text', text: 'posted' }],
        },
        {
          id: new ObjectId().toHexString(),
          role: 'assistant',
          parts:
            n < 34
              ? []
              : [
                  {
                    type: 'turn-interrupted',
                    id: 'x',
                    reason: 'error',
                    message: 'Frame too large',
                  },
                ],
        },
      ]).flat()

      await store(stuck)
      replyParts = [{ type: 'text', text: 'Noted.' }]
      const next = wake()

      await enqueuePendingUserMessage(OWNER, SESSION, next)
      await startQueuedTurn(OWNER, SESSION)

      expect(inputs).toEqual([[next.id]])
      const last = await agentMessages().findOne({ messageId: stuck.at(-1)!.id })

      expect(last?.parts).toEqual(stuck.at(-1)!.parts)
    })
  },
)
