import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { agent } from './router'

import type { AgentConversation } from '@/lib/agent/db'
import type * as dbActual from '@/lib/db'

const TEAM = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const OWNER = '111111111111111111111111'
const TEAMMATE = '222222222222222222222222'
let viewer = OWNER
let member = true
let memory = portabilityDb()
let conversation: AgentConversation

useIdentity({
  authenticateToken: async () => ({ user: { id: viewer } }),
  getTeamMembership: async () => (member ? ({ role: 'MEMBER' } as never) : null),
})
useDb({ db: (() => memory) as unknown as typeof dbActual.db })
useAgentDb({
  getReadableConversation: async (id, _viewer, team) =>
    id === 'session' && team === TEAM ? conversation : null,
})

const app = new Hono().route('/agent', agent)

app.onError(errorHandler)
beforeEach(() => {
  viewer = OWNER
  member = true
  memory = portabilityDb()
  conversation = {
    sessionId: 'session',
    userId: OWNER,
    teamId: TEAM,
    title: 'Demo review',
    firstMessage: 'Review the layout',
    messageCount: 2,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    generalAccess: 'reply',
    pendingDecision: {
      category: 'preference',
      question: 'Which direction?',
      toolCallId: 'question-1',
      askedAt: new Date(),
    },
  }
  memory.rows('agent_conversations').push(conversation)
})

function resolve(id = 'question-1', resolution: unknown = 'answered', team = TEAM) {
  return app.request(`/agent/conversations/session/decisions/${id}/resolve?teamId=${team}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ resolution }),
  })
}

test('an exact answer resolves durably and repeated resolution is harmless', async () => {
  const response = await resolve()

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, resolved: true })
  expect(conversation.pendingDecision).toBeUndefined()
  expect(await (await resolve()).json()).toEqual({ ok: true, resolved: false })
})

test('a late answer cannot clear a newer question from the same agent', async () => {
  conversation.pendingDecision!.toolCallId = 'question-2'

  expect(await (await resolve()).json()).toEqual({ ok: true, resolved: false })
  expect(conversation.pendingDecision?.toolCallId).toBe('question-2')
})

test('a teammate with reply access can dismiss the owner’s question', async () => {
  viewer = TEAMMATE

  expect((await resolve('question-1', 'dismissed')).status).toBe(200)
  expect(conversation.pendingDecision).toBeUndefined()
})

test('viewers and former team members cannot resolve a question', async () => {
  viewer = TEAMMATE
  conversation.generalAccess = 'view'
  expect((await resolve()).status).toBe(403)
  member = false
  expect((await resolve()).status).toBe(404)
  expect(conversation.pendingDecision?.toolCallId).toBe('question-1')
})

test('a different team scope cannot resolve this question', async () => {
  expect((await resolve('question-1', 'answered', 'bbbbbbbbbbbbbbbbbbbbbbbb')).status).toBe(404)
  expect(conversation.pendingDecision).toBeDefined()
})

test('an invalid resolution is refused without changing the question', async () => {
  expect((await resolve('question-1', 'navigated-away')).status).toBe(400)
  expect((await resolve('question-1', { $ne: null })).status).toBe(400)
  expect(conversation.pendingDecision).toBeDefined()
})
