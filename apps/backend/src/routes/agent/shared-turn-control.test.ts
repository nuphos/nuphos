import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { agent } from './router'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
let actor = 'bbbbbbbbbbbbbbbbbbbbbbbb'
let member = true
let cancelled = 0
let steered = 0
const conversation = { sessionId: 'shared-control', userId: 'owner', teamId }

useIdentity({
  authenticateToken: async () => ({ user: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb' } }),
  getTeamMembership: async () => (member ? { role: 'MEMBER' } : null),
})
useAgentDb({
  getReadableConversation: async (_id, _user, team) => (team === teamId ? conversation : null),
})
useAgentRunStore({ getActiveAgentRunForSession: async () => ({ actorUserId: actor }) })
useSessionExecutionState({
  conversationExecutionState: async () => ({ schemaVersion: 2, actions: { steer: true } }),
  cancelConversationRuntime: async () => {
    cancelled++
  },
  steerConversationRuntime: async () => {
    steered++
  },
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 403 | 404 | 409 }).status ?? 500),
)
beforeEach(() => {
  actor = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  member = true
  cancelled = 0
  steered = 0
})
const request = (action: string) =>
  app.request(`/agent/conversations/shared-control/${action}?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Please continue' }),
  })

test('a teammate can stop and steer their own active turn', async () => {
  expect((await request('cancel-runtime')).status).toBe(200)
  expect((await request('steer')).status).toBe(200)
  expect(cancelled).toBe(1)
  expect(steered).toBe(1)
})

test('a teammate cannot control another actor’s turn or a revoked team session', async () => {
  actor = 'owner'
  expect((await request('cancel-runtime')).status).toBe(403)
  expect((await request('steer')).status).toBe(409)
  actor = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  member = false
  expect((await request('cancel-runtime')).status).toBe(404)
  expect((await request('steer')).status).toBe(404)
  expect(cancelled).toBe(0)
  expect(steered).toBe(0)
})
