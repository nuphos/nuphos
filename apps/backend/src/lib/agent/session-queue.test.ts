import { afterEach, beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { config } from '@/config'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRedis } from '@/lib/test/doubles/redis'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { startQueuedTurn } from './queued-turn'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from './pending-messages'
import {
  listPendingUserMessages,
  queueHead,
  requeuePendingAtHead,
  takePendingUserMessages,
} from './pending-queue'
import { installQueuedTurnStarter, requeueTurnQueue, sessionReleased } from './session-released'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type { PendingUserMessage, QueuedChatTurn } from './pending-message-types'
import type { TurnRunner } from './turn-runner'

const OWNER = 'owner'
const SESSION = 'queue-session'
const conversation = {
  sessionId: SESSION,
  userId: OWNER,
  teamId: 'team',
  firstMessage: 'Start',
} as AgentConversation
let runtimeSend = true
let released = 0
const runs: Parameters<TurnRunner['runAgentForTrigger']>[0][] = []
const launched: PendingUserMessage[] = []

let member = true
let fakeRedis: unknown = null

useRedis({
  withRedis: (async (op: (client: unknown) => unknown) =>
    fakeRedis ? op(fakeRedis) : null) as never,
})

useIdentity({
  signNuphosToken: () => 'test-token',
  getTeamMembership: async () => (member ? ({ role: 'MEMBER' } as never) : null),
})
useAgentDb({
  getConversationBySessionId: async () => ({ ...conversation, claudeCodePreview: {} as never }),
  getConversationWithMessages: async () => ({ conversation, messages: [] }),
})
useSessionExecutionState({
  conversationExecutionState: async () => ({
    schemaVersion: 2,
    state: runtimeSend ? 'idle' : 'active',
    actions: { send: runtimeSend, cancel: !runtimeSend, steer: !runtimeSend },
  }),
})

function chatTurn(text: string): QueuedChatTurn {
  return {
    streamId: `stream-${text}`,
    message: { id: `ui-${text}`, role: 'user', parts: [{ type: 'text', text }] },
    locale: 'en',
    localTools: true,
  }
}

function human(text: string, actorUserId = OWNER): PendingUserMessage {
  return {
    ...buildPendingUserMessage({ renderedText: text, source: 'app', actorUserId }),
    chat: chatTurn(text),
  }
}

const agent = (text: string) =>
  buildPendingUserMessage({ renderedText: text, source: 'agent.thread', actorUserId: OWNER })

async function queue(...messages: PendingUserMessage[]) {
  for (const message of messages) await enqueuePendingUserMessage(OWNER, SESSION, message)
}

const waiting = async () =>
  (await listPendingUserMessages(OWNER, SESSION)).map((message) => message.renderedText)

beforeEach(() => {
  member = true
  runtimeSend = true
  released = 0
  runs.length = 0
  launched.length = 0
  installTurnRunner({
    hasActiveAgentRunForSession: async () => false,
    claimAgentRunForSession: async () => () => {
      released++
    },
    runAgentForTrigger: async (args) => {
      runs.push(args)

      return { status: 'completed' }
    },
    launchQueuedChatTurn: async (_conversation, item) => {
      launched.push(item)
    },
  })
})
afterEach(async () => {
  resetTurnRunner()
  await clearPendingUserMessages(OWNER, SESSION)
})

test('the head of the queue is the oldest transcript message; an app send runs alone', () => {
  const a = agent('a')
  const b = agent('b')
  const h = human('h')
  const c = agent('c')
  const slack = buildPendingUserMessage({ renderedText: 's', source: 'slack', actorUserId: OWNER })

  expect(queueHead([slack, a, b, h, c], OWNER)).toEqual([a, b])
  expect(queueHead([h, a], OWNER)).toEqual([h])
  // Only a head its actor may fold in, and never an app send.
  expect(queueHead([h, a], OWNER, OWNER)).toEqual([])
  expect(queueHead([a, h], OWNER, OWNER)).toEqual([a])
  expect(queueHead([agent('x'), human('t', 'teammate')], OWNER, 'teammate')).toEqual([])
})

test('a person who sent first runs first, as their own chat turn', async () => {
  const first = human('send first')

  await queue(first, agent('agent later'))
  await startQueuedTurn(OWNER, SESSION)

  expect(launched.map((item) => item.id)).toEqual([first.id])
  expect(launched[0]?.chat?.streamId).toBe('stream-send first')
  expect(runs).toHaveLength(0)
  // The chat turn holds the claim until it ends.
  expect(released).toBe(0)
  expect(await waiting()).toEqual(['agent later'])
})

test('agent messages at the head run together; the person behind them goes next', async () => {
  await queue(agent('a'), agent('b'), human('h'), agent('c'))
  await startQueuedTurn(OWNER, SESSION)

  expect(runs).toHaveLength(1)
  expect(runs[0]?.messages.map((message) => message.parts)).toEqual([
    [{ type: 'text', text: 'a' }],
    [{ type: 'text', text: 'b' }],
  ])
  expect(released).toBe(1)
  expect(await waiting()).toEqual(['h', 'c'])
})

test("a teammate's message runs with the teammate as its sender", async () => {
  await queue(human('from a teammate', 'teammate'))
  await startQueuedTurn(OWNER, SESSION)

  expect(launched[0]?.actorUserId).toBe('teammate')
})

test('a runtime busy with work outside any backend turn leaves the queue alone', async () => {
  runtimeSend = false
  await queue(human('wait'))
  await startQueuedTurn(OWNER, SESSION)

  expect(launched).toHaveLength(0)
  expect(released).toBe(0)
  expect(await waiting()).toEqual(['wait'])
})

test('a refused queued turn goes back to the front of the queue', async () => {
  const refused = human('refused')

  await queue(agent('behind'))
  await requeueTurnQueue(OWNER, SESSION, [], refused)

  expect(await waiting()).toEqual(['refused', 'behind'])
})

test("releasing the session starts the queue for a teammate's message too", async () => {
  const started: string[] = []

  installQueuedTurnStarter(async (_userId, sessionId) => {
    started.push(sessionId)
  })
  try {
    await enqueuePendingUserMessage(OWNER, 'released-session', human('from a teammate', 'teammate'))
    sessionReleased(OWNER, 'released-session')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(started).toEqual(['released-session'])
  } finally {
    installQueuedTurnStarter(startQueuedTurn)
    await clearPendingUserMessages(OWNER, 'released-session')
  }
})

test("an older client's steering message from a teammate never runs as the owner", async () => {
  const legacy = buildPendingUserMessage({
    renderedText: 'teammate steer',
    source: 'app',
    actorUserId: 'teammate',
  })

  await queue(legacy, agent('owner agent'))
  await startQueuedTurn(OWNER, SESSION)

  expect(runs).toHaveLength(1)
  expect(runs[0]?.messages.map((message) => message.parts)).toEqual([
    [{ type: 'text', text: 'owner agent' }],
  ])
  expect(await waiting()).toEqual(['teammate steer'])
})

test('a launch that fails puts the message back at the head, counted', async () => {
  installTurnRunner({
    hasActiveAgentRunForSession: async () => false,
    claimAgentRunForSession: async () => () => {
      released++
    },
    launchQueuedChatTurn: async () => {
      throw new Error('runtime lookup failed')
    },
  })
  await queue(human('retry me'), agent('behind'))
  await startQueuedTurn(OWNER, SESSION)

  const [head] = await listPendingUserMessages(OWNER, SESSION)

  expect(await waiting()).toEqual(['retry me', 'behind'])
  expect(head?.attempts).toBe(1)
  expect(released).toBe(1)
})

test('a message refused too often, or waiting too long, is dropped instead of retried', async () => {
  await queue(
    { ...human('refused'), attempts: 5 },
    { ...agent('old'), receivedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() },
    human('next'),
  )
  await startQueuedTurn(OWNER, SESSION)

  expect(launched.map((item) => item.renderedText)).toEqual(['next'])
  expect(await waiting()).toEqual([])
})

test("a sender who left the conversation's team is not spoken for", async () => {
  member = false
  await queue(human('gone', 'teammate'))
  await startQueuedTurn(OWNER, SESSION)

  expect(launched).toHaveLength(0)
  expect(await waiting()).toEqual([])
})

test('two releases racing for one session start its head once', async () => {
  let held = false

  installTurnRunner({
    hasActiveAgentRunForSession: async () => false,
    claimAgentRunForSession: async () => {
      if (held) return null
      held = true

      return () => {
        held = false
      }
    },
    launchQueuedChatTurn: async (_conversation, item) => {
      launched.push(item)
    },
  })
  await queue(human('once'), human('twice'))
  await Promise.all([startQueuedTurn(OWNER, SESSION), startQueuedTurn(OWNER, SESSION)])

  expect(launched.map((item) => item.renderedText)).toEqual(['once'])
})

test('with Redis, a take removes exactly its own messages and a requeue keeps the expiry', async () => {
  const list: string[] = []
  const expiries: number[] = []
  let ttl = 600
  const client = {
    lrange: async () => [...list],
    lrem: async (_key: string, _count: number, value: string) => {
      const index = list.indexOf(value)

      if (index < 0) return 0
      list.splice(index, 1)

      return 1
    },
    lpush: async (_key: string, ...values: string[]) => list.unshift(...values),
    ttl: async () => ttl,
    expire: async (_key: string, seconds: number) => expiries.push(seconds),
  }
  const enabled = config.redis.enabled

  fakeRedis = client
  config.redis.enabled = true
  try {
    const victim = { ...human('victim', 'teammate'), id: 'victim' }
    const attacker = { ...human('mine'), id: 'x|victim|' }

    list.push(JSON.stringify(victim), JSON.stringify(attacker))
    expect((await takePendingUserMessages(OWNER, SESSION, [attacker])).map((m) => m.id)).toEqual([
      'x|victim|',
    ])
    expect(list.map((raw) => (JSON.parse(raw) as PendingUserMessage).id)).toEqual(['victim'])
    // A second take of the same message finds nothing.
    expect(await takePendingUserMessages(OWNER, SESSION, [attacker])).toEqual([])
    await requeuePendingAtHead(OWNER, SESSION, [attacker])
    expect(list.map((raw) => (JSON.parse(raw) as PendingUserMessage).id)).toEqual([
      'x|victim|',
      'victim',
    ])
    expect(expiries).toEqual([])
    // A list that had emptied lost its expiry; the requeue sets it again.
    list.length = 0
    ttl = -2
    await requeuePendingAtHead(OWNER, SESSION, [attacker])
    expect(expiries).toEqual([3600])
  } finally {
    fakeRedis = null
    config.redis.enabled = enabled
  }
})
