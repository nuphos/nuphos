import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { agent } from './router'

import {
  buildPendingUserMessage,
  drainPendingUserMessages,
  enqueuePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { listPendingUserMessages } from '@/lib/agent/pending-queue'
import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
let member = true
let cancelled = 0
let steered = 0
let steeredWith: unknown[] = []
const conversation = { sessionId: 'shared-control', userId: 'owner', teamId }

useIdentity({
  authenticateToken: async () => ({ user: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb' } }),
  getTeamMembership: async () => (member ? { role: 'MEMBER' } : null),
})
useAgentDb({
  getReadableConversation: async (_id, _user, team) => (team === teamId ? conversation : null),
})
useSessionExecutionState({
  conversationExecutionState: async () => ({ schemaVersion: 2, actions: { steer: true } }),
  cancelConversationRuntime: async () => {
    cancelled++
  },
  steerConversationRuntime: async (...args) => {
    steered++
    steeredWith = args.slice(1)
    queuedWhileSteering = (await listPendingUserMessages('owner', 'shared-control')).map(
      (message) => message.id,
    )
    if (refuse) throw new AppError(409, 'runtime_steering_unavailable', 'The turn already ended.')

    return 'receipt'
  },
})
let refuse = false
let queuedWhileSteering: string[] = []
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 403 | 404 | 409 }).status ?? 500),
)
beforeEach(async () => {
  member = true
  cancelled = 0
  steered = 0
  refuse = false
  await drainPendingUserMessages('owner', 'shared-control')
})
const request = (action: string) =>
  app.request(`/agent/conversations/shared-control/${action}?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Please continue' }),
  })

test('a teammate can stop and steer the active turn, whoever started it', async () => {
  expect((await request('cancel-runtime')).status).toBe(200)
  expect((await request('steer')).status).toBe(200)
  expect(cancelled).toBe(1)
  expect(steered).toBe(1)
})

test('a revoked team member cannot control the session', async () => {
  member = false
  expect((await request('cancel-runtime')).status).toBe(404)
  expect((await request('steer')).status).toBe(404)
  expect(cancelled).toBe(0)
  expect(steered).toBe(0)
})

test('steering forwards an uploaded group and returns the delivered receipt', async () => {
  const response = await app.request(`/agent/conversations/shared-control/steer?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ groupId: 'group-1' }),
  })

  expect(response.status).toBe(200)
  expect(((await response.json()) as { text: string }).text).toBe('receipt')
  expect(steeredWith[0]).toEqual({
    text: '',
    groupId: 'group-1',
    userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  })
})

async function queueTwo() {
  const sender = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  const first = buildPendingUserMessage({ renderedText: 'one', source: 'app', actorUserId: sender })
  const second = buildPendingUserMessage({ renderedText: 'two', source: 'app', actorUserId: sender })

  await enqueuePendingUserMessage('owner', 'shared-control', first)
  await enqueuePendingUserMessage('owner', 'shared-control', second)

  return { first, second }
}
const steerQueued = (queuedId: string) =>
  app.request(`/agent/conversations/shared-control/steer?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'two', queuedId }),
  })
const queuedIds = async () =>
  (await listPendingUserMessages('owner', 'shared-control')).map((message) => message.id)

test('a queued message leaves the queue before it steers, so the queue cannot also run it', async () => {
  const { first, second } = await queueTwo()

  expect((await steerQueued(second.id)).status).toBe(200)
  expect(queuedWhileSteering).toEqual([first.id])
  expect(await queuedIds()).toEqual([first.id])
})

test('a refused steer puts the queued message back at the front', async () => {
  const { first, second } = await queueTwo()

  refuse = true
  expect((await steerQueued(second.id)).status).toBe(409)
  expect(await queuedIds()).toEqual([second.id, first.id])
})

test('a queued message that already left the queue is not steered', async () => {
  expect((await steerQueued('gone')).status).toBe(404)
  expect(steered).toBe(0)
})
