import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
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

// What each woken agent was told.
const told: string[] = []

useConversationTurn({
  startConversationTurn: async (_data, _target, text) => {
    told.push(text)

    return { status: 'started' as const, run: Promise.resolve(undefined) }
  },
})

const app = new Hono().route('/agent', agent)

app.onError(errorHandler)
beforeEach(() => {
  told.length = 0
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
    generalAccess: 'view',
    participantIds: [TEAMMATE],
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

function post(path: string, body: unknown, team = TEAM) {
  return app.request(`/agent/conversations/session/decisions/${path}?teamId=${team}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function resolve(
  id = 'question-1',
  resolution: unknown = 'answered',
  team = TEAM,
  extra: Record<string, unknown> = {},
) {
  return post(`${id}/resolve`, { resolution, ...extra }, team)
}

const snooze = (until: unknown, id = 'question-1') => post(`${id}/snooze`, { until })
const snoozedUntil = (id: string) =>
  conversation.inputRequests?.find((r) => r.id === id)?.snoozedUntil
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000)

const statusOf = (id: string) => conversation.inputRequests?.find((r) => r.id === id)?.status

test('an exact answer takes only that request off the list, and repeating it is harmless', async () => {
  const response = await resolve()

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, resolved: true })
  expect(statusOf('question-1')).toBeUndefined()
  expect(statusOf('question-2')).toBe('open')
  expect(await (await resolve()).json()).toEqual({ ok: true, resolved: false })
})

test('a newer question never hides an older open one', async () => {
  expect(await (await resolve('question-2')).json()).toEqual({ ok: true, resolved: true })
  expect(statusOf('question-1')).toBe('open')
})

test('a participant can dismiss the owner’s question, and the agent that asked is told', async () => {
  viewer = TEAMMATE

  expect((await resolve('question-1', 'dismissed')).status).toBe(200)
  expect(statusOf('question-1')).toBeUndefined()
  expect(statusOf('question-2')).toBe('open')
  expect(told).toHaveLength(1)
  expect(told[0]).toContain('Your question (requestId question-1) was dismissed')
})

test('dismissing a question that is gone says so instead of succeeding silently', async () => {
  expect((await resolve('question-1', 'dismissed')).status).toBe(200)
  const again = await resolve('question-1', 'dismissed')

  expect(again.status).toBe(409)
  expect(await again.json()).toMatchObject({
    error: { message: 'This question is no longer open' },
  })
  expect(told).toHaveLength(1)
})

test('a dismissal passes its reason to the agent that asked', async () => {
  const response = await resolve('question-1', 'dismissed', TEAM, {
    reason: '  Not this sprint.  ',
  })

  expect(response.status).toBe(200)
  expect(told[0]).toContain('Reason: Not this sprint.')
})

test('a dismissal reason that is not short text is refused, and the question stays open', async () => {
  for (const reason of [42, 'x'.repeat(1_001)])
    expect((await resolve('question-1', 'dismissed', TEAM, { reason })).status).toBe(400)
  expect(statusOf('question-1')).toBe('open')
  expect(told).toEqual([])
})

test('the owner snoozes a question until a time, and clears it, without telling the agent', async () => {
  const until = inHours(1)
  const response = await snooze(until.toISOString())

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, snoozedUntil: until.toISOString() })
  expect(snoozedUntil('question-1')).toEqual(until)
  expect(snoozedUntil('question-2')).toBeUndefined()
  expect(statusOf('question-1')).toBe('open')

  expect(await (await snooze(null)).json()).toEqual({ ok: true, snoozedUntil: null })
  expect(snoozedUntil('question-1')).toBeUndefined()
  expect(told).toEqual([])
})

test('a snooze must end in the future and within 30 days', async () => {
  for (const until of [
    new Date(Date.now() - 1_000).toISOString(),
    inHours(31 * 24).toISOString(),
    'soon',
    5,
  ])
    expect((await snooze(until)).status).toBe(400)
  expect(snoozedUntil('question-1')).toBeUndefined()
})

test('only the owner, whose Inbox it is, can snooze a question', async () => {
  viewer = TEAMMATE

  expect((await snooze(inHours(1).toISOString())).status).toBe(403)
  expect(snoozedUntil('question-1')).toBeUndefined()
})

test('snoozing a question that is no longer open is refused', async () => {
  expect((await snooze(inHours(1).toISOString(), 'question-9')).status).toBe(409)
})

test('viewers and former team members cannot resolve a question', async () => {
  viewer = TEAMMATE
  conversation.participantIds = []
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
