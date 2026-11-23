import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useConversationComputer } from '@/lib/test/doubles/conversation-computer'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { usePendingMessages } from '@/lib/test/doubles/pending-messages'
import { usePendingQueue } from '@/lib/test/doubles/pending-queue'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { agent } from './router'

import type * as dbActual from '@/lib/db'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const userId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const conversation = { sessionId: 'steer-1', userId, teamId, title: 'Chat' }
let waiting: Record<string, unknown>[] = []
const pulled: unknown[] = []

useIdentity({
  authenticateToken: async () => ({ user: { id: userId } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
})
useAgentDb({ getReadableConversation: async () => conversation })
useConversationComputer({ canReplyIn: async () => true })
useAgentRunStore({ getActiveAgentRunForSession: async () => null })
useSessionExecutionState({
  conversationExecutionState: async () => ({ state: 'active', actions: { steer: true } }),
  steerConversationRuntime: async (_conversation, steer) => steer.text,
})
usePendingQueue({ listPendingUserMessages: async () => waiting })
usePendingMessages({ removePendingUserMessage: async () => true })
useDb({
  db: () => ({
    collection: () => ({
      updateOne: async (_filter: unknown, update: { $pull?: { inputRequests?: unknown } }) => {
        pulled.push(update.$pull?.inputRequests)

        return { matchedCount: 1 }
      },
    }),
  }),
})

const app = new Hono().route('/agent', agent)
const steer = (body: Record<string, unknown>) =>
  app.request(`/agent/conversations/steer-1/steer?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  waiting = []
  pulled.length = 0
})

test('a waiting decision answer steered in resolves its request', async () => {
  waiting = [
    { id: 'q1', source: 'app', actorUserId: userId, chat: { decisionReplyTo: 'decision-1' } },
  ]
  const res = await steer({ text: 'yes', queuedId: 'q1' })

  expect(res.status).toBe(200)
  expect(pulled).toEqual([{ id: 'decision-1' }])
})

test('a waiting message that answers nothing resolves no request', async () => {
  waiting = [{ id: 'q1', source: 'app', actorUserId: userId }]
  const res = await steer({ text: 'also this', queuedId: 'q1' })

  expect(res.status).toBe(200)
  expect(pulled).toEqual([])
})

test('a steer typed straight in, not taken from the queue, resolves no request', async () => {
  const res = await steer({ text: 'also this' })

  expect(res.status).toBe(200)
  expect(pulled).toEqual([])
})
