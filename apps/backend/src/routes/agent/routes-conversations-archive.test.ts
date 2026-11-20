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
let kind: string | undefined
let participantIds = [caller]
let moved: ArchiveUnit = { sessionIds: [] }
const calls: [string, boolean][] = []
const memberCalls: [string, string, boolean][] = []

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
})
useAgentDb({
  getReadableConversation: async (sessionId, _user, team) =>
    team === teamId
      ? { sessionId, userId: owner, teamId, participantIds, ...(kind ? { kind } : {}) }
      : null,
  setConversationArchived: async (sessionId, archived) => {
    calls.push([sessionId, archived])

    return moved
  },
  setMemberArchived: async (sessionId, userId, archived) => {
    memberCalls.push([sessionId, userId, archived])
  },
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 400 | 404 }).status ?? 500),
)
beforeEach(() => {
  owner = caller
  kind = undefined
  participantIds = [caller]
  moved = { sessionIds: [] }
  calls.length = 0
  memberCalls.length = 0
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

test('the body must say which way', async () => {
  expect((await archive('s1', 'yes')).status).toBe(400)
  expect(calls).toEqual([])
})

test("someone else's Task is archived for the caller alone", async () => {
  owner = 'someone-else'

  expect(await (await archive('s1', true)).json()).toEqual({
    ok: true,
    archived: true,
    sessionIds: ['s1'],
  })
  await archive('s1', false)
  expect(memberCalls).toEqual([
    ['s1', caller, true],
    ['s1', caller, false],
  ])
  expect(calls).toEqual([])
})

test("someone else's group chat is left, not archived, and a Task they are not in is not theirs to archive", async () => {
  owner = 'someone-else'
  kind = 'channel'

  expect((await archive('s1', true)).status).toBe(404)
  // So is a Task they only read, as a teammate: it is in no list of theirs.
  kind = undefined
  participantIds = []
  expect((await archive('s1', true)).status).toBe(404)
  expect(memberCalls).toEqual([])
})
