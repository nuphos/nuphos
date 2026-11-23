import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { agent } from './router'

import type { BotSelfUpdate } from '@/lib/agent/db/maintenance'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const owner = 'bbbbbbbbbbbbbbbbbbbbbbbb'

let caller = owner
const stored = new Map<string, string>()
const writes: [string, string, string | undefined, BotSelfUpdate][] = []

useIdentity({
  authenticateToken: () => Promise.resolve({ user: { id: caller } }),
  getTeamMembership: () => Promise.resolve({ role: 'MEMBER' }),
})
// Only the owner's Bot is written, as the real update matches on owner and face.
useAgentDb({
  updateBotSelf: (sessionId, userId, team, update) => {
    writes.push([sessionId, userId, team, update])
    if (sessionId !== 'bot' || userId !== owner) return Promise.resolve(false)
    stored.set(sessionId, update.instructions ?? '')

    return Promise.resolve(true)
  },
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 400 | 404 }).status ?? 500),
)
beforeEach(() => {
  caller = owner
  stored.clear()
  writes.length = 0
})
const save = (sessionId: string, body: object) =>
  app.request(`/agent/conversations/${sessionId}/instructions`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ teamId, ...body }),
  })

test("the owner rewrites a Bot's instructions through update_self's write", async () => {
  const response = await save('bot', { instructions: '  Review releases weekly.  ' })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ instructions: 'Review releases weekly.' })
  expect(writes).toEqual([['bot', owner, teamId, { instructions: 'Review releases weekly.' }]])
  expect(stored.get('bot')).toBe('Review releases weekly.')
})

test('empty clears them, as update_self does', async () => {
  expect((await save('bot', { instructions: '' })).status).toBe(200)
  expect(stored.get('bot')).toBe('')
})

test("anyone else, or a Task, is told it isn't there", async () => {
  caller = 'cccccccccccccccccccccccc'
  expect((await save('bot', { instructions: 'Mine now' })).status).toBe(404)
  caller = owner
  expect((await save('task', { instructions: 'Be a Bot' })).status).toBe(404)
  expect(stored.size).toBe(0)
})

test("update_self's limits hold", async () => {
  expect((await save('bot', { instructions: 'x'.repeat(8001) })).status).toBe(400)
  expect((await save('bot', { instructions: 5 })).status).toBe(400)
  expect((await save('bot', { instructions: 'ok', avatar: '01-a' })).status).toBe(400)
  expect(writes).toEqual([])
})
