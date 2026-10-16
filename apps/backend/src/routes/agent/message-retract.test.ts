import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { agent } from './router'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'
let events: string[] = []
let activeTurn: string | undefined
let verdict: 'retracted' | 'not_sender' | 'answered' = 'retracted'

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
})
useAgentDb({
  getReadableConversation: async () => ({
    sessionId: 's1',
    userId: 'owner',
    teamId,
    claudeCodePreviewContext: activeTurn ? { activeTurnKey: activeTurn } : {},
  }),
  retractTrailingUserMessage: async (args) => {
    events.push(`${args.dryRun ? 'check' : 'retract'}:${args.actorUserId}:${args.messageId}`)

    return verdict
  },
})
useSessionExecutionState({
  cancelConversationRuntime: () => {
    events.push('cancel')
    // The turn writes its end and clears its marker shortly after the cancel.
    setTimeout(() => {
      activeTurn = undefined
    }, 300)

    return Promise.resolve()
  },
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 403 | 409 }).status ?? 500),
)
beforeEach(() => {
  events = []
  activeTurn = 'turn-1'
  verdict = 'retracted'
})
const retract = () =>
  app.request(`/agent/conversations/s1/messages/m1/retract?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  })

test('stops the turn, waits for it to end, then drops the message', async () => {
  expect((await retract()).status).toBe(200)
  expect(events).toEqual([`check:${caller}:m1`, 'cancel', `retract:${caller}:m1`])
  expect(activeTurn).toBeUndefined()
})

test("never stops a turn for someone else's message", async () => {
  verdict = 'not_sender'
  expect((await retract()).status).toBe(403)
  expect(events).toEqual([`check:${caller}:m1`])
})

test('keeps an answered message and leaves its turn running', async () => {
  verdict = 'answered'
  expect((await retract()).status).toBe(409)
  expect(events).toEqual([`check:${caller}:m1`])
})

test('refuses when no turn is running', async () => {
  activeTurn = undefined
  expect((await retract()).status).toBe(409)
  expect(events).toEqual([])
})
