import '@/routes/agent'

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { listPendingUserMessages } from '@/lib/agent/pending-queue'
import { AppError, errorHandler } from '@/lib/errors'
import { queuedRefusal, refusal } from '@/lib/claude-code-preview/runtime-refusal'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useBoxWake } from '@/lib/test/doubles/box-wake'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { claimAgentRunOrEnqueue } from './claim-or-enqueue'
import { agentRuns, createAgentRun, registerAgentRun } from './run-registry'
import { admitQueueableChat, queueForOfflineBox } from './session-queue-turn'

import type { AgentConversation } from '@/lib/agent/db'
import type { UIMessage } from 'ai'

const OWNER = '64b5f1c2e4b0a1d2c3e4f5a6'
const TEAMMATE = '64b5f1c2e4b0a1d2c3e4f5a7'
const SESSION = 'session-queue'
const conversation = { sessionId: SESSION, userId: OWNER, teamId: 'team' } as AgentConversation
let caller = OWNER

// Turn admission looks the conversation up; none here means no move is running.
useDb({ db: (() => ({ collection: () => ({ findOne: async () => null }) })) as never })
useIdentity({ authenticateToken: async () => ({ user: { id: caller } }) })
let boxOffline = true
const woken: (string | undefined)[] = []
const stamped: string[] = []

useAgentDb({
  getReadableConversation: async () => conversation,
  stampConversationRuntimeInstance: async (_sessionId, runtimeId) => {
    stamped.push(runtimeId)
  },
})
useBoxWake({
  wakeOfflineBox: async (runtimeId) => {
    woken.push(runtimeId)

    return boxOffline
  },
})

const { agent } = await import('./router')
const app = new Hono().route('/agent', agent).onError(errorHandler)

const message = (id: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: `text ${id}` }],
})

function admit(id: string, overrides: Partial<Parameters<typeof admitQueueableChat>[0]> = {}) {
  return admitQueueableChat({
    body: { id: SESSION, messages: [message(id)], clientCapabilities: { serverQueue: true } },
    conversation,
    runOwnerUserId: OWNER,
    userId: OWNER,
    streamId: `stream-${id}`,
    readOnlyResume: false,
    clientView: [message(id)],
    snapshot: undefined,
    slackBound: false,
    context: { locale: 'en', localTools: true, kubeContext: 'prod' },
    credentialAccess: undefined,
    ...overrides,
  })
}

function busy() {
  const run = createAgentRun(OWNER, SESSION, 'stream-busy', {
    requestId: 'request-busy',
    userId: OWNER,
    sessionId: SESSION,
    streamId: 'stream-busy',
    route: 'agent.thread',
    method: 'TRIGGER',
  })

  registerAgentRun(run)

  return () => {
    run.done = true
    run.releaseOwnership()
    agentRuns.delete(run.key)
  }
}

const request = (path: string, method = 'GET') =>
  app.request(`/agent${path}`, { method, headers: { Authorization: 'Bearer test-token' } })

beforeEach(() => {
  caller = OWNER
})
afterEach(async () => {
  await clearPendingUserMessages(OWNER, SESSION)
})

test('an older client, or a continuation, keeps the earlier admission', async () => {
  expect(await admit('a', { body: { id: SESSION, messages: [message('a')] } })).toBeNull()
  expect(
    await admit('a', {
      body: {
        id: SESSION,
        messages: [message('a')],
        clientCapabilities: { serverQueue: true },
        continueAfterInterruption: true,
      },
    }),
  ).toBeNull()
})

test('a free session runs the message now and holds the claim for it', async () => {
  const admitted = await admit('now')

  expect(admitted?.mode).toBe('run')
  // Kept for the turn: a runtime refusal mid-start requeues it at the head.
  if (admitted?.mode === 'run') {
    expect(admitted.item).toMatchObject({ id: 'now', chat: { streamId: 'stream-now' } })
    admitted.release()
  }
  expect(await listPendingUserMessages(OWNER, SESSION)).toEqual([])
})

test('a busy session queues the message with the context its device sent it with', async () => {
  const done = busy()

  try {
    expect((await admit('later'))?.mode).toBe('queued')
  } finally {
    done()
  }
  const [queued] = await listPendingUserMessages(OWNER, SESSION)

  expect(queued).toMatchObject({
    id: 'later',
    source: 'app',
    actorUserId: OWNER,
    renderedText: 'text later',
    chat: { streamId: 'stream-later', localTools: true, kubeContext: 'prod', locale: 'en' },
  })
})

test('a runtime busy outside any backend turn queues the message too', async () => {
  const admitted = await admit('wait', {
    snapshot: {
      schemaVersion: 2,
      state: 'active',
      actions: { send: false, cancel: true, steer: true },
    },
  })

  expect(admitted?.mode).toBe('queued')
  expect((await listPendingUserMessages(OWNER, SESSION)).map((m) => m.id)).toEqual(['wait'])
})

test('a send to an offline Box queues at once, even on a free session without a runtime status', async () => {
  const box = { ...conversation, claudeCodePreview: {} } as AgentConversation

  // Without the Box there is no runtime status; an ordinary send keeps the earlier admission.
  expect(await admit('plain', { conversation: box })).toBeNull()
  expect((await admit('offline', { conversation: box, runtimeOffline: true }))?.mode).toBe('queued')
  expect((await listPendingUserMessages(OWNER, SESSION)).map((item) => item.id)).toEqual([
    'offline',
  ])
})

test('a send queues only for the Box its runtime resolution authorized', async () => {
  const offline = (runtimeId?: string) =>
    new AppError(409, 'runtime_offline', 'offline', runtimeId ? { runtimeId } : undefined)
  const send = (id: string, pinned?: string) => ({
    body: {
      id: SESSION,
      messages: [message(id)],
      clientCapabilities: { serverQueue: true },
      runtimeId: 'box-b',
    },
    conversation: {
      ...conversation,
      claudeCodePreview: {},
      ...(pinned ? { runtimeId: pinned } : {}),
    } as AgentConversation,
    runOwnerUserId: OWNER,
    userId: OWNER,
    streamId: `stream-${id}`,
    readOnlyResume: false,
    clientView: [message(id)],
    slackBound: false,
    context: { locale: 'en', localTools: true },
    credentialAccess: undefined,
  })

  woken.length = 0
  stamped.length = 0
  await expect(queueForOfflineBox(new Error('boom'), send('a'))).rejects.toThrow('boom')
  // No authorized placement (a body-named Box, another team's): nothing is woken.
  const unplaced = offline()

  await expect(queueForOfflineBox(unplaced, send('a'))).rejects.toBe(unplaced)
  expect(woken).toEqual([])
  boxOffline = false
  const awake = offline('box-a')

  await expect(queueForOfflineBox(awake, send('a', 'box-a'))).rejects.toBe(awake)
  boxOffline = true
  // Pinned to A, the body asking for B: A is woken and kept, B is ignored.
  expect(await queueForOfflineBox(offline('box-a'), send('pinned', 'box-a'))).toBeNull()
  expect(woken).toEqual(['box-a', 'box-a'])
  expect(stamped).toEqual([])
  // An unpinned conversation keeps the Box chosen here for the queue to start it on.
  expect(await queueForOfflineBox(offline('box-a'), send('unpinned'))).toBeNull()
  expect(stamped).toEqual(['box-a'])
  expect((await listPendingUserMessages(OWNER, SESSION)).map((item) => item.id)).toEqual([
    'pinned',
    'unpinned',
  ])
})

test('an agent message waits behind a person who sent first, even on a free session', async () => {
  const done = busy()

  await admit('first')
  done()
  const thread = buildPendingUserMessage({ renderedText: 'CI passed', source: 'agent.thread' })
  const outcome = await claimAgentRunOrEnqueue({
    userId: OWNER,
    sessionId: SESSION,
    message: thread,
  })

  expect(outcome.mode).toBe('queued')
  expect((await listPendingUserMessages(OWNER, SESSION)).map((m) => m.id)).toEqual([
    'first',
    thread.id,
  ])
})

test('everyone in the conversation sees the queue; only the sender takes a message back', async () => {
  await enqueuePendingUserMessage(OWNER, SESSION, {
    ...buildPendingUserMessage({ renderedText: 'mine', source: 'app', actorUserId: OWNER }),
    id: 'mine',
  })
  caller = TEAMMATE
  const listed = (await (await request(`/conversations/${SESSION}/queue`)).json()) as {
    messages: { id: string; mine: boolean }[]
  }

  expect(listed.messages).toMatchObject([{ id: 'mine', mine: false }])
  expect((await request(`/conversations/${SESSION}/queue/mine`, 'DELETE')).status).toBe(403)
  caller = OWNER
  expect((await request(`/conversations/${SESSION}/queue/mine`, 'DELETE')).status).toBe(200)
  expect(await listPendingUserMessages(OWNER, SESSION)).toEqual([])
  expect((await request(`/conversations/${SESSION}/queue/mine`, 'DELETE')).status).toBe(404)
})

test("an older client's new message waits behind the queue: refused, so it resends", async () => {
  const done = busy()

  await admit('first')
  done()
  await expect(
    admit('legacy', { body: { id: SESSION, messages: [message('legacy')] } }),
  ).rejects.toMatchObject({
    code: 'runtime_not_accepting_message',
  })
})

test('a message id that could match another message is refused', async () => {
  const id = 'x|victim'

  await expect(
    admit(id, {
      clientView: [message(id)],
      body: { id: SESSION, messages: [message(id)], clientCapabilities: { serverQueue: true } },
    }),
  ).rejects.toMatchObject({ status: 400 })
})

test('a refused start of a queued message tells the client it waits, not that it was refused', () => {
  const refused = refusal('Responding…')

  expect(queuedRefusal(refused, { id: 'queued' })).toMatchObject({ code: 'message_queued' })
  // Nothing was queued: the refusal stands, so the client knows to send again.
  expect(queuedRefusal(refused, undefined)).toBe(refused)
})
