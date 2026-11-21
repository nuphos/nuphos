import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAutoModeStore } from '@/lib/test/doubles/auto-mode-store'
import { useIdentity } from '@/lib/test/doubles/identity'

import { agent } from './router'

import type { AgentConversation } from '@/lib/agent/db'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const owner = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const member = 'cccccccccccccccccccccccc'

let caller = member
let inTeam = true
let readable = true
const bypassBy = new Map([[owner, true]])
const sets: [string, string, boolean][] = []

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => (inTeam ? { role: 'MEMBER' } : null),
})
useAgentDb({
  getConversationBySessionId: async (sessionId) =>
    ({ sessionId, userId: owner, teamId }) as AgentConversation,
  getReadableConversation: async (sessionId, _user, team) =>
    readable && team === teamId
      ? ({ sessionId, userId: owner, teamId } as AgentConversation)
      : null,
  recordAgentEvent: () => {},
})
useAutoModeStore({
  getSessionBypass: async (_sessionId, userId) => bypassBy.get(userId) === true,
  setSessionBypass: (sessionId, userId, bypass) => {
    sets.push([sessionId, userId, bypass])

    return Promise.resolve()
  },
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 400 | 404 }).status ?? 500),
)
beforeEach(() => {
  caller = member
  inTeam = true
  readable = true
  sets.length = 0
})
const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json' }
const read = () => app.request('/agent/auto-mode/bypass?sessionId=bot', { headers })
const set = (bypass: boolean) =>
  app.request('/agent/auto-mode/bypass', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ sessionId: 'bot', bypass }),
  })

test("a member who may read a teammate's Bot reads its owner's mode", async () => {
  const response = await read()

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ enabled: true, bypass: true })
})

test('only the owner changes the mode', async () => {
  expect((await set(false)).status).toBe(404)
  expect(sets).toEqual([])
  caller = owner
  expect((await set(false)).status).toBe(200)
  expect(sets).toEqual([['bot', owner, false]])
})

test('anyone who may not read the conversation is told it is not there', async () => {
  readable = false
  expect((await read()).status).toBe(404)
  readable = true
  inTeam = false
  expect((await read()).status).toBe(404)
})

test('the owner reads their own mode', async () => {
  caller = owner
  inTeam = false
  expect(await (await read()).json()).toEqual({ enabled: true, bypass: true })
})
