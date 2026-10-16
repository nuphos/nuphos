import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useLiveTurn } from '@/lib/test/doubles/live-turn'
import { useRetractMarks } from '@/lib/test/doubles/retract-marks'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { agent } from './router'
import { retractTurnEndWait } from './routes-message-retract'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const otherTeam = 'cccccccccccccccccccccccc'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'

type Outcome = 'retracted' | 'not_sender' | 'answered'
let events: string[] = []
let activeTurn: string | undefined
let carried = false
let liveOutput = false
let stops = true
let check: Outcome = 'retracted'
let final: Outcome = 'retracted'

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
})
useAgentDb({
  getReadableConversation: async (_session, _user, team) =>
    team === teamId
      ? {
          sessionId: 's1',
          userId: 'owner',
          teamId,
          claudeCodePreviewContext: activeTurn ? { activeTurnKey: activeTurn } : {},
        }
      : null,
  retractTrailingUserMessage: async (args) => {
    events.push(`${args.dryRun ? 'check' : 'retract'}:${args.actorUserId}:${args.messageId}`)

    return args.dryRun ? check : final
  },
})
useRetractMarks({
  turnCarried: async (turnKey) => carried && turnKey === activeTurn,
  markRetracted: async () => {
    events.push('mark')
  },
})
useLiveTurn({ liveTurnHasOutput: async () => liveOutput })
useSessionExecutionState({
  cancelConversationRuntime: () => {
    events.push('cancel')
    // The turn writes its end and clears its marker shortly after the cancel.
    if (stops)
      setTimeout(() => {
        activeTurn = undefined
      }, 30)

    return Promise.resolve()
  },
})
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 403 | 404 | 409 }).status ?? 500),
)
beforeEach(() => {
  events = []
  activeTurn = 'turn-1'
  carried = false
  liveOutput = false
  stops = true
  check = 'retracted'
  final = 'retracted'
  retractTurnEndWait.ms = 200
  retractTurnEndWait.pollMs = 10
})
const retract = (team = teamId) =>
  app.request(`/agent/conversations/s1/messages/m1/retract?teamId=${team}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  })
const checked = `check:${caller}:m1`

test('stops the turn, waits for it to end, drops the message and tells the next prompt', async () => {
  expect((await retract()).status).toBe(200)
  expect(events).toEqual([checked, 'cancel', `retract:${caller}:m1`, 'mark'])
})

test("never stops a turn for someone else's message", async () => {
  check = 'not_sender'
  expect((await retract()).status).toBe(403)
  expect(events).toEqual([checked])
})

test('never stops a turn that already has output in flight', async () => {
  liveOutput = true
  expect((await retract()).status).toBe(409)
  expect(events).toEqual([checked])
})

test("never stops a turn that carried in someone else's queued message", async () => {
  carried = true
  expect((await retract()).status).toBe(409)
  expect(events).toEqual([checked])
})

test('keeps the message when the stopped turn persisted output after all', async () => {
  final = 'answered'
  expect((await retract()).status).toBe(409)
  expect(events).toEqual([checked, 'cancel', `retract:${caller}:m1`])
})

test('gives up, keeping the message, when the turn does not stop in time', async () => {
  stops = false
  expect((await retract()).status).toBe(409)
  expect(events).toEqual([checked, 'cancel'])
})

test('refuses when no turn is running', async () => {
  activeTurn = undefined
  expect((await retract()).status).toBe(409)
  expect(events).toEqual([])
})

test('another team cannot see the conversation', async () => {
  expect((await retract(otherTeam)).status).toBe(404)
  expect(events).toEqual([])
})
