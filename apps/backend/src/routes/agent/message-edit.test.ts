import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { agent } from './router'

import type { AgentConversation } from '@/lib/agent/db'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const otherTeam = 'cccccccccccccccccccccccc'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'

let recorded: string[] = []
let participants: string[] = []
let forks: Record<string, Partial<AgentConversation>> = {}

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
})
useAgentDb({
  getReadableConversation: async (_session, _user, team) =>
    team === teamId
      ? { sessionId: 's1', userId: 'owner', teamId, participantIds: participants }
      : null,
  getConversationBySessionId: async (sessionId) => forks[sessionId] ?? null,
  recordMessageEditedInFork: async (sessionId, actorId, forkSessionId) => {
    recorded.push(`${sessionId}:${actorId}:${forkSessionId}`)
  },
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 403 | 404 }).status ?? 500),
)
beforeEach(() => {
  recorded = []
  participants = [caller]
  forks = { f1: { sessionId: 'f1', userId: caller, teamId } }
})
const linkFork = (forkSessionId = 'f1', team = teamId) =>
  app.request('/agent/conversations/s1/edit-forks', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ forkSessionId, teamId: team }),
  })

test('links the conversation to the fork its edited message ran in', async () => {
  expect((await linkFork()).status).toBe(200)
  expect(recorded).toEqual([`s1:${caller}:f1`])
})

test('a viewer who cannot reply cannot leave the line', async () => {
  participants = []
  expect((await linkFork()).status).toBe(403)
  expect(recorded).toEqual([])
})

test("never links someone else's chat as the fork", async () => {
  forks = { f1: { sessionId: 'f1', userId: 'owner', teamId } }
  expect((await linkFork()).status).toBe(404)
  expect(recorded).toEqual([])
})

test('never links a fork from another team, a missing one, or itself', async () => {
  forks = { f1: { sessionId: 'f1', userId: caller, teamId: otherTeam } }
  expect((await linkFork()).status).toBe(404)
  expect((await linkFork('missing')).status).toBe(404)
  forks = { s1: { sessionId: 's1', userId: caller, teamId } }
  expect((await linkFork('s1')).status).toBe(404)
  expect(recorded).toEqual([])
})

test('another team cannot see the conversation', async () => {
  expect((await linkFork('f1', otherTeam)).status).toBe(404)
  expect(recorded).toEqual([])
})
