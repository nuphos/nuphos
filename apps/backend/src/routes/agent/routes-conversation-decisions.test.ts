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
    inputRequests: [
      {
        id: 'question-1',
        category: 'preference',
        question: 'Which direction?',
        askedAt: new Date('2026-10-27T01:00:00Z'),
        status: 'open',
      },
      {
        id: 'question-2',
        category: 'preference',
        question: 'Which palette?',
        askedAt: new Date('2026-10-27T02:00:00Z'),
        status: 'open',
      },
    ],
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

const statusOf = (id: string) => conversation.inputRequests?.find((r) => r.id === id)?.status

test('an exact answer resolves only that request, and repeating it is harmless', async () => {
  const response = await resolve()

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, resolved: true })
  expect(statusOf('question-1')).toBe('answered')
  expect(conversation.inputRequests?.[0]?.resolvedAt).toBeInstanceOf(Date)
  expect(statusOf('question-2')).toBe('open')
  expect(await (await resolve()).json()).toEqual({ ok: true, resolved: false })
})

test('a newer question never hides an older open one', async () => {
  expect(await (await resolve('question-2')).json()).toEqual({ ok: true, resolved: true })
  expect(statusOf('question-1')).toBe('open')
})

test('a question stored before request lists still resolves by its id', async () => {
  delete conversation.inputRequests
  conversation.pendingDecision = {
    category: 'preference',
    question: 'Which direction?',
    toolCallId: 'question-1',
    askedAt: new Date(),
  }

  expect(await (await resolve('question-2')).json()).toEqual({ ok: true, resolved: false })
  expect(conversation.pendingDecision).toBeDefined()
  expect(await (await resolve()).json()).toEqual({ ok: true, resolved: true })
  expect(conversation.pendingDecision).toBeUndefined()
})

test('a teammate with reply access can dismiss the owner’s question', async () => {
  viewer = TEAMMATE

  expect((await resolve('question-1', 'dismissed')).status).toBe(200)
  expect(statusOf('question-1')).toBe('dismissed')
})

test('viewers and former team members cannot resolve a question', async () => {
  viewer = TEAMMATE
  conversation.generalAccess = 'view'
  expect((await resolve()).status).toBe(403)
  member = false
  expect((await resolve()).status).toBe(404)
  expect(statusOf('question-1')).toBe('open')
})

test('a different team scope cannot resolve this question', async () => {
  expect((await resolve('question-1', 'answered', 'bbbbbbbbbbbbbbbbbbbbbbbb')).status).toBe(404)
  expect(statusOf('question-1')).toBe('open')
})

test('an invalid resolution is refused without changing the question', async () => {
  expect((await resolve('question-1', 'navigated-away')).status).toBe(400)
  expect((await resolve('question-1', { $ne: null })).status).toBe(400)
  expect(statusOf('question-1')).toBe('open')
})
