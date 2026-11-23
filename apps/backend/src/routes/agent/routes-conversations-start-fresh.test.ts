import '@/routes/agent'

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { sessionsByConversation } from '@/lib/claude-code-preview/agent-chat-registry'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { agent } from './router'

import type { AgentConversation, AgentMessage } from '@/lib/agent/db'
import type { TeamSession } from '@/lib/claude-code-preview/team-openab-runtime'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const owner = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const mate = 'cccccccccccccccccccccccc'

const bot = {
  sessionId: 'bot',
  userId: owner,
  teamId,
  title: 'Scout',
  avatar: '05-rembrandt',
} as AgentConversation
const task = { ...bot, sessionId: 'task', avatar: undefined } as AgentConversation
const said = (index: number, role: 'user' | 'assistant', text: string) =>
  ({ messageId: `m${String(index)}`, index, role, parts: [{ type: 'text', text }] }) as AgentMessage

let caller = owner
let replying = false
let forgetFails = false
let writes: unknown[][] = []
let closed: string[] = []

useIdentity({
  authenticateToken: () => Promise.resolve({ user: { id: caller } }),
  getTeamMembership: () => Promise.resolve({ role: 'MEMBER' }),
})
// A readable Bot for everyone in the team, as a shared one is; only its owner may start it fresh.
useAgentDb({
  getReadableConversation: (sessionId) =>
    Promise.resolve([bot, task].find((one) => one.sessionId === sessionId) ?? null),
  getConversationMessages: () =>
    Promise.resolve([
      said(6, 'user', 'Check the deploy'),
      said(7, 'assistant', 'It is green'),
      said(8, 'user', 'Thanks'),
      said(9, 'assistant', 'Anytime'),
    ]),
  updateCompactionSummary: (...args) => {
    writes.push(['summary', ...args])

    return Promise.resolve()
  },
  getConversationPreviewAttachment: () =>
    Promise.resolve({
      openabSessionId: 'inner-1',
      runtimeUrl: 'wss://runtime.invalid/acp',
      runtimeDefaults: { model: 'opus' },
    }),
  forgetConversationPreviewSession: (...args) => {
    if (forgetFails) return Promise.reject(new Error('settings write failed'))
    writes.push(['forget', ...args])

    return Promise.resolve()
  },
  recordBotStartedFresh: (...args) => {
    writes.push(['timeline', args[0].sessionId, args[1]])

    return Promise.resolve()
  },
  recordAgentEvent: () => {},
})
// A turn holds the session's claim while the Bot replies.
useAgentRunStore({
  getActiveAgentRunForSession: () =>
    Promise.resolve(replying ? { streamId: 'turn', startedAt: '', actorUserId: owner } : null),
  reserveActiveAgentRunForSession: () => Promise.resolve(() => Promise.resolve()),
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })

const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json(
    { error: (error as { code?: string }).code, message: error.message },
    (error as { status?: 404 | 409 }).status ?? 500,
  ),
)
beforeEach(() => {
  caller = owner
  replying = false
  forgetFails = false
  writes = []
  closed = []
  sessionsByConversation.set(`${teamId}:bot`, {
    openabSessionId: 'inner-1',
    client: {
      closeSession: (id: string) => {
        closed.push(id)

        return Promise.resolve()
      },
    },
  } as unknown as TeamSession)
})
// The registry is process-wide: a session left in it would reach later suites.
afterEach(() => sessionsByConversation.delete(`${teamId}:bot`))
const startFresh = (sessionId: string) =>
  app.request(`/agent/conversations/${sessionId}/start-fresh`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ teamId }),
  })

test('its owner starts a Bot fresh: a summary covers every message so far, and its session goes', async () => {
  const response = await startFresh('bot')

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ messageCount: 10 })
  const summary = writes.find(([kind]) => kind === 'summary')

  expect(summary?.slice(1, 3)).toEqual(['bot', owner])
  expect(summary?.[4]).toBe(10)
  // No model writes it: it says where the earlier messages are and quotes the last of them.
  expect(summary?.[3]).toContain('none of your messages before #10')
  expect(summary?.[3]).toContain('read_conversation')
  expect(summary?.[3]).toContain('Assistant: Anytime')
  // The session it had is dropped as a lost one is, keeping the settings it ran with.
  expect(writes).toContainEqual([
    'forget',
    'bot',
    teamId,
    'inner-1',
    { model: 'opus' },
    { actorId: owner, via: 'fresh_start' },
  ])
  expect(writes).toContainEqual(['timeline', 'bot', owner])
  expect(sessionsByConversation.has(`${teamId}:bot`)).toBe(false)
  expect(closed).toEqual(['inner-1'])
})

test('while it replies, starting it fresh is refused and nothing changes', async () => {
  replying = true
  const response = await startFresh('bot')

  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({
    error: 'conversation_busy',
    message: 'Wait for Scout to finish replying, then start it fresh.',
  })
  expect(writes).toEqual([])
  expect(sessionsByConversation.has(`${teamId}:bot`)).toBe(true)
})

test('if its session cannot be forgotten, no summary claims an earlier start', async () => {
  forgetFails = true
  const response = await startFresh('bot')

  expect(response.status).toBe(500)
  // It keeps its live session, so a summary here would hide messages from a later lost one.
  expect(writes).toEqual([])
  expect(sessionsByConversation.has(`${teamId}:bot`)).toBe(true)
})

test("a teammate who can read the Bot, or a Task, is told it isn't there", async () => {
  caller = mate
  expect((await startFresh('bot')).status).toBe(404)
  caller = owner
  expect((await startFresh('task')).status).toBe(404)
  expect(writes).toEqual([])
})
