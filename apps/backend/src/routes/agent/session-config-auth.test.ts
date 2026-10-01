import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionConfig } from '@/lib/test/doubles/session-config'

import type { AuthVariables } from '@/middleware/auth'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
let member = true
let owner = 'viewer'
let storedTeam = teamId
let calls = 0
const conversation = () => ({ sessionId: 'config-auth-test', userId: owner, teamId: storedTeam })

useIdentity({ getTeamMembership: () => Promise.resolve(member ? { role: 'MEMBER' } : null) })
useAgentDb({
  getReadableConversation: (_id, _user, requestedTeam) =>
    Promise.resolve(requestedTeam === storedTeam ? conversation() : null),
  getConversationBySessionId: () => Promise.resolve(conversation()),
})
useAgentRunStore({ getActiveAgentRunForSession: () => Promise.resolve(null) })
useSessionConfig({
  conversationSessionConfig: () => {
    calls++

    return Promise.resolve({ status: 'ready', options: [] })
  },
})
const { sessionConfigRoutes } = await import('./routes-session-config')
const agent = new Hono<{ Variables: AuthVariables }>()

agent.use('*', async (c, next) => {
  c.set('userId', 'viewer')
  await next()
})
agent.route('/', sessionConfigRoutes)
agent.onError((error, c) =>
  error instanceof AppError
    ? c.json({ code: error.code }, error.status)
    : c.json({ code: 'unexpected' }, 500),
)

beforeEach(() => {
  member = true
  owner = 'viewer'
  storedTeam = teamId
  calls = 0
})
const request = (method = 'GET', suffix = `?teamId=${teamId}`, value: unknown = 'model-a') =>
  agent.request(`/conversations/config-auth-test/model-config${suffix}`, {
    method,
    ...(method === 'PATCH'
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ configId: 'model', value }),
        }
      : {}),
  })

test('requires current workspace membership before contacting the runtime', async () => {
  member = false
  expect((await request()).status).toBe(403)
  expect((await request('PATCH')).status).toBe(403)
  expect(calls).toBe(0)
})

test('rejects missing or mismatched workspace scopes', async () => {
  expect((await request('GET', '')).status).toBe(403)
  storedTeam = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  expect((await request()).status).toBe(404)
  expect((await request('PATCH')).status).toBe(409)
  expect(calls).toBe(0)
})

test('team viewers may read settings but only the owner may change them', async () => {
  owner = 'teammate'
  expect((await request()).status).toBe(200)
  expect((await request('PATCH')).status).toBe(403)
  expect(calls).toBe(1)
})

test('rejects invalid values before accessing the runtime and permits an owner selection', async () => {
  expect((await request('PATCH', `?teamId=${teamId}`, true)).status).toBe(400)
  expect(calls).toBe(0)
  expect((await request('PATCH')).status).toBe(200)
  expect(calls).toBe(1)
})
