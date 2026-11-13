import '@/routes/agent'

import { beforeEach, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'

import { agent } from './router'

import {
  buildPendingUserMessage,
  drainPendingUserMessages,
  enqueuePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { listPendingUserMessages } from '@/lib/agent/pending-queue'
import { startQueuedTurn } from '@/lib/agent/queued-turn'
import { installQueuedTurnStarter } from '@/lib/agent/session-released'
import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const me = 'bbbbbbbbbbbbbbbbbbbbbbbb'
let member = true
let activeActor: string | null = null
let cancelled = 0
let steered = 0
let steeredWith: unknown[] = []
const conversation = { sessionId: 'shared-control', userId: 'owner', teamId, participantIds: [me] }

let agentToken: { id: string; kind: 'agent'; name: string } | undefined

useIdentity({
  authenticateToken: async () => ({
    user: { id: me },
    ...(agentToken ? { cliToken: agentToken } : {}),
  }),
  getTeamMembership: async () => (member ? { role: 'MEMBER' } : null),
})
useAgentDb({
  getReadableConversation: async (_id, _user, team) => (team === teamId ? conversation : null),
})
useAgentRunStore({
  getActiveAgentRunForSession: async () =>
    activeActor
      ? { streamId: 'running', startedAt: null, actorUserId: activeActor, runtimeOwned: false }
      : null,
  requestAgentRunCancellation: async (_user, streamId) => {
    stoppedRuns.push(streamId)

    return true
  },
})
useSessionExecutionState({
  conversationExecutionState: async () => ({
    state: steerable ? 'active' : 'idle',
    schemaVersion: 2,
    phase: steerable ? 'running_tools' : 'resuming',
    actions: { steer: steerable },
  }),
  cancelConversationRuntime: async () => {
    if (unreachable) throw new Error('The agent could not be reached')
    cancelled++
  },
  putConversationSecret: async () => {
    secretsSaved++

    return '/runtime/nuphos-secret-x/0/KEY'
  },
  steerConversationRuntime: async (...args) => {
    steered++
    steeredWith = args.slice(1)
    queuedWhileSteering = (await listPendingUserMessages('owner', 'shared-control')).map(
      (message) => message.id,
    )
    if (refuse)
      throw new AppError(409, 'runtime_steering_unavailable', 'The turn already ended.', {
        outcome: 'promptRequired',
        reason: 'noRunningTurn',
      })

    return 'receipt'
  },
})
let refuse = false
let steerable = true
let unreachable = false
let stoppedRuns: string[] = []
let queueStarts: string[] = []
let secretsSaved = 0
let queuedWhileSteering: string[] = []
const app = new Hono().route('/agent', agent)

app.onError((error, c) =>
  c.json({ error: error.message }, (error as { status?: 403 | 404 | 409 }).status ?? 500),
)
beforeEach(async () => {
  member = true
  activeActor = null
  cancelled = 0
  steered = 0
  refuse = false
  steerable = true
  unreachable = false
  stoppedRuns = []
  queueStarts = []
  agentToken = undefined
  await drainPendingUserMessages('owner', 'shared-control')
})
const request = (action: string) =>
  app.request(`/agent/conversations/shared-control/${action}?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Please continue' }),
  })

test('a teammate can stop and steer the active turn, whoever started it', async () => {
  const stop = await request('cancel-runtime')

  expect(stop.status).toBe(200)
  expect(await stop.json()).toMatchObject({ stopped: true })
  expect((await request('steer')).status).toBe(200)
  expect(cancelled).toBe(1)
  expect(steered).toBe(1)
})

// Agent threads, resource events and triggers run as the session owner, so the
// owner steers them instead of waiting behind them (Desktop 0.88.1 regression).
test('you steer a running turn you are the actor of, including agent-started ones', async () => {
  activeActor = me
  expect((await request('steer')).status).toBe(200)
  expect(steered).toBe(1)
})

test("another person's running turn refuses the steer, so the message waits its turn", async () => {
  activeActor = 'cccccccccccccccccccccccc'
  expect((await request('steer')).status).toBe(409)
  expect(steered).toBe(0)
})

test('a revoked team member cannot control the session', async () => {
  member = false
  expect((await request('cancel-runtime')).status).toBe(404)
  expect((await request('steer')).status).toBe(404)
  expect(cancelled).toBe(0)
  expect(steered).toBe(0)
})

test('steering forwards an uploaded group and returns the delivered receipt', async () => {
  const response = await app.request(`/agent/conversations/shared-control/steer?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ groupId: 'group-1' }),
  })

  expect(response.status).toBe(200)
  expect(((await response.json()) as { text: string }).text).toBe('receipt')
  expect(steeredWith[0]).toEqual({
    text: '',
    groupId: 'group-1',
    userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  })
})

async function queueTwo() {
  const sender = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  const first = buildPendingUserMessage({ renderedText: 'one', source: 'app', actorUserId: sender })
  const second = buildPendingUserMessage({
    renderedText: 'two',
    source: 'app',
    actorUserId: sender,
  })

  await enqueuePendingUserMessage('owner', 'shared-control', first)
  await enqueuePendingUserMessage('owner', 'shared-control', second)

  return { first, second }
}
const steerQueued = (queuedId: string) =>
  app.request(`/agent/conversations/shared-control/steer?teamId=${teamId}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'two', queuedId }),
  })
const queuedIds = async () =>
  (await listPendingUserMessages('owner', 'shared-control')).map((message) => message.id)

test('a queued message leaves the queue before it steers, so the queue cannot also run it', async () => {
  const { first, second } = await queueTwo()

  expect((await steerQueued(second.id)).status).toBe(200)
  expect(queuedWhileSteering).toEqual([first.id])
  expect(await queuedIds()).toEqual([first.id])
})

test('a refused steer puts the queued message back at the front', async () => {
  const { first, second } = await queueTwo()

  refuse = true
  expect((await steerQueued(second.id)).status).toBe(409)
  expect(await queuedIds()).toEqual([second.id, first.id])
})

test('a queued message that already left the queue is not steered', async () => {
  expect((await steerQueued('gone')).status).toBe(404)
  expect(steered).toBe(0)
})

test('a steer sent with an agent token is attributed to that agent, not its user', async () => {
  agentToken = { id: 'token-1', kind: 'agent', name: 'Release bot' }
  activeActor = me

  expect((await request('steer')).status).toBe(200)
  expect(steeredWith[0]).toMatchObject({ userId: me, cliToken: agentToken })
})

test('only the conversation owner can provide a secret, not a teammate who can reply', async () => {
  const save = () =>
    app.request(`/agent/conversations/shared-control/secrets?teamId=${teamId}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'OPENAI_API_KEY', value: 'sk-test' }),
    })

  secretsSaved = 0
  expect((await save()).status).toBe(403)
  expect(secretsSaved).toBe(0)
  conversation.userId = me
  try {
    expect(await (await save()).json()).toEqual({
      ok: true,
      path: '/runtime/nuphos-secret-x/0/KEY',
    })
    expect(secretsSaved).toBe(1)
  } finally {
    conversation.userId = 'owner'
  }
})

// A dropped runtime connection can leave the backend holding a turn the runtime
// no longer runs, or a runtime that cannot be reached. Stop still gets the
// person out: it stops the held turn, and what waited behind it goes next.
test('Stop ends a turn the backend still holds and starts the queue, even if the runtime is unreachable', async () => {
  activeActor = 'owner'
  unreachable = true
  await enqueuePendingUserMessage(
    'owner',
    'shared-control',
    buildPendingUserMessage({ renderedText: 'and then deploy', source: 'app' }),
  )

  installQueuedTurnStarter(async (_user, sessionId) => {
    queueStarts.push(sessionId)
  })
  try {
    expect((await request('cancel-runtime')).status).toBe(200)
    expect(stoppedRuns).toEqual(['running'])
    await Bun.sleep(0)
    expect(queueStarts).toEqual(['shared-control'])
  } finally {
    installQueuedTurnStarter(startQueuedTurn)
    await drainPendingUserMessages('owner', 'shared-control')
  }
})

test('Stop with nothing held and no runtime to reach reports the failure', async () => {
  unreachable = true

  expect((await request('cancel-runtime')).status).toBe(500)
  expect(stoppedRuns).toEqual([])
})

test('Stop on an idle conversation says nothing was running instead of failing', async () => {
  steerable = false
  unreachable = true
  const response = await request('cancel-runtime')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, status: 'requested', stopped: false })
})

const steerRefusals = async (send: () => Response | Promise<Response>) => {
  const log = spyOn(console, 'log').mockImplementation(() => {})

  try {
    expect((await send()).status).toBe(409)

    return log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((entry) => entry.event === 'agent.steer.refused')
  } finally {
    log.mockRestore()
  }
}

test('a steer the runtime snapshot refuses is logged with the phase that refused it', async () => {
  steerable = false

  expect(await steerRefusals(() => request('steer'))).toEqual([
    expect.objectContaining({
      reason: 'runtime_actions',
      session_id: 'shared-control',
      phase: 'resuming',
      runtime_state: 'idle',
    }),
  ])
})

test('a steer the runtime did not inject is logged with its outcome', async () => {
  refuse = true

  expect(await steerRefusals(() => request('steer'))).toEqual([
    expect.objectContaining({
      reason: 'not_injected',
      outcome: 'promptRequired',
      outcome_reason: 'noRunningTurn',
    }),
  ])
})
