import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useConversationComputer } from '@/lib/test/doubles/conversation-computer'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useIdentity } from '@/lib/test/doubles/identity'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'
let exists = true
let mayReply = true
const woken: string[] = []

useAuthMiddleware({
  requireAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', caller)
    await next()
  },
})
useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) })
useAgentDb({
  getConversationBySessionId: async (sessionId) =>
    exists ? ({ sessionId, userId: 'owner', teamId } as never) : null,
})
useConversationComputer({ canReplyIn: async () => mayReply })
useConversationTurn({
  startConversationTurn: async (data, _target, text) => {
    woken.push(`${data.targetSessionId}: ${text}`)

    return { status: 'started' as const, run: Promise.resolve(undefined) }
  },
})

await import('./routes-conversation-browser')
const { agent } = await import('./router')

const app = new Hono().route('/agent', agent).onError(errorHandler)
const handBack = (body: unknown) =>
  app.request(`/agent/conversations/s1/browser/hand-back?teamId=${teamId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  exists = true
  mayReply = true
  woken.length = 0
})

test('a person who may reply wakes the conversation, naming the tab', async () => {
  expect((await handBack({ tab: 7 })).status).toBe(200)
  expect(woken).toHaveLength(1)
  expect(woken[0]).toStartWith('s1: ')
  expect(woken[0]).toContain('tab 7')
})

test('a person who may only read gets 403 and wakes nothing', async () => {
  mayReply = false
  const response = await handBack({ tab: 7 })

  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ error: { code: 'conversation_read_only' } })
  expect(woken).toEqual([])
})

test('a body without a tab id gets 400 and wakes nothing', async () => {
  for (const body of [{}, { tab: 'one' }, { tab: 7, extra: true }]) {
    expect((await handBack(body)).status).toBe(400)
  }
  expect(woken).toEqual([])
})

test('an unknown conversation gets 404 and wakes nothing', async () => {
  exists = false
  expect((await handBack({ tab: 7 })).status).toBe(404)
  expect(woken).toEqual([])
})
