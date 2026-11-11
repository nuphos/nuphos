import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { agent } from './router'

import type { ArchiveUnit } from '@/lib/agent/db/archive'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'

let owner = caller
let moved: ArchiveUnit = { sessionIds: [] }
const calls: [string, boolean][] = []

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
})
useAgentDb({
  getReadableConversation: async (sessionId, _user, team) =>
    team === teamId ? { sessionId, userId: owner, teamId } : null,
  setConversationArchived: async (sessionId, archived) => {
    calls.push([sessionId, archived])

    return moved
  },
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 400 | 404 }).status ?? 500),
)
beforeEach(() => {
  owner = caller
  moved = { sessionIds: [] }
  calls.length = 0
})
const archive = (sessionId: string, archived: unknown) =>
  app.request(`/agent/conversations/${sessionId}/archive?teamId=${teamId}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ archived }),
  })

test('says what moved with the conversation: a Bot and its chat', async () => {
  moved = { sessionIds: ['bot', 'bot-chat'], botSessionId: 'bot' }
  const response = await archive('bot', true)

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    ok: true,
    archived: true,
    sessionIds: ['bot', 'bot-chat'],
    botSessionId: 'bot',
  })
  expect(calls).toEqual([['bot', true]])
})

test('a chat archived on its own names only itself', async () => {
  moved = { sessionIds: ['bot-chat'] }

  expect(await (await archive('bot-chat', true)).json()).toEqual({
    ok: true,
    archived: true,
    sessionIds: ['bot-chat'],
  })
})

test('only the owner archives, and the body must say which way', async () => {
  expect((await archive('s1', 'yes')).status).toBe(400)
  owner = 'someone-else'
  expect((await archive('s1', true)).status).toBe(404)
  expect(calls).toEqual([])
})
