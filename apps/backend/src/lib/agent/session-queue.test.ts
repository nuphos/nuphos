import { afterEach, beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useBoxWake } from '@/lib/test/doubles/box-wake'
import { config } from '@/config'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRedis } from '@/lib/test/doubles/redis'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { refusal } from '@/lib/claude-code-preview/runtime-refusal'

import { startConversationTurn } from './conversation-turn'
import { startQueuedTurn } from './queued-turn'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from './pending-messages'
import {
  hasQueuedTranscriptMessage,
  hasWaitingMessageFrom,
  listPendingUserMessages,
  queueHead,
  takeTurnQueue,
  requeuePendingAtHead,
  takePendingUserMessages,
} from './pending-queue'
import {
  installQueuedTurnStarter,
  requeueTurnQueue,
  sessionReleased,
  sweepQueuedSessions,
} from './session-released'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type { PendingUserMessage, QueuedChatTurn } from './pending-message-types'
import type { SignInRequest } from './sign-in-request'
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
let boxOffline = false
const wakes: (string | undefined)[] = []
let fakeRedis: unknown = null
let signInRequest: SignInRequest | null = null
let conversationRuntime = 'managed-1'

useRedis({
  withRedis: (async (op: (client: unknown) => unknown) =>
    fakeRedis ? op(fakeRedis) : null) as never,
})

useIdentity({
  signNuphosToken: () => 'test-token',
  getTeamMembership: async () => (member ? ({ role: 'MEMBER' } as never) : null),
})
useAgentDb({
  agentMessages: () => ({ findOne: async () => null }),
  getConversationBySessionId: async () => ({
    ...conversation,
    claudeCodePreview: {} as never,
    // On the agent the ask is about, unless a test moves it.
    ...(signInRequest ? { signInRequest, runtimeId: conversationRuntime } : {}),
  }),
  getConversationWithMessages: async () => ({ conversation, messages: [] }),
})
useBoxWake({
  wakeOfflineBox: async (runtimeId) => {
    wakes.push(runtimeId)

    return boxOffline
  },
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
  signInRequest = null
  conversationRuntime = 'managed-1'
  boxOffline = false
  wakes.length = 0
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
  // Agent messages batch only with the same sending session.
  const other = {
    ...agent('other'),
    metadata: { sender: { type: 'agent', id: 'other-session' } } as never,
  }

  expect(queueHead([a, other, b], OWNER)).toEqual([a])
  // An older client's steering message from a teammate is never a head.
  expect(queueHead([{ ...agent('t'), source: 'app', actorUserId: 'teammate' }], OWNER)).toEqual([])
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

test('an offline Box keeps the queue waiting, uncounted, until it is back', async () => {
  boxOffline = true
  await queue(human('wait for the box'))
  await startQueuedTurn(OWNER, SESSION)

  expect(launched).toHaveLength(0)
  expect((await listPendingUserMessages(OWNER, SESSION))[0]?.attempts).toBeUndefined()
  expect(wakes).toHaveLength(1)
  expect(released).toBe(1)

  boxOffline = false
  await startQueuedTurn(OWNER, SESSION)

  expect(launched.map((item) => item.renderedText)).toEqual(['wait for the box'])
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

test("a teammate's waiting steering message neither restarts the queue nor blocks it", async () => {
  let starts = 0

  installQueuedTurnStarter(async (userId, sessionId) => {
    starts++
    await startQueuedTurn(userId, sessionId)
  })
  installTurnRunner({
    hasActiveAgentRunForSession: async () => false,
    // A real claim's release announces the release, as run-admission does.
    claimAgentRunForSession: async () => () => {
      released++
      sessionReleased(OWNER, 'f9-session')
    },
  })
  try {
    await enqueuePendingUserMessage(OWNER, 'f9-session', {
      ...buildPendingUserMessage({
        renderedText: 'legacy',
        source: 'app',
        actorUserId: 'teammate',
      }),
    })
    expect(await hasQueuedTranscriptMessage(OWNER, 'f9-session')).toBe(false)
    sessionReleased(OWNER, 'f9-session')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(starts).toBe(0)
    // The teammate's own turn still takes it.
    expect(
      (await takeTurnQueue(OWNER, 'f9-session', 'teammate')).map((m) => m.renderedText),
    ).toEqual(['legacy'])
  } finally {
    installQueuedTurnStarter(startQueuedTurn)
    await clearPendingUserMessages(OWNER, 'f9-session')
  }
})

test("an agent message never joins or interrupts a person's turn; it runs next as its own", async () => {
  const report = buildPendingUserMessage({
    renderedText: 'CI passed',
    source: 'agent.thread',
    actorUserId: OWNER,
    metadata: { sender: { type: 'agent', id: 'reviewer' } } as never,
  })

  await queue(report)
  // The person's running turn folds nothing in and keeps its pending approval.
  expect(await takeTurnQueue(OWNER, SESSION, OWNER)).toEqual([])
  expect(await hasWaitingMessageFrom(OWNER, SESSION, OWNER)).toBe(false)
  // Their own next message would supersede it.
  await queue(human('wait, use staging'))
  expect(await hasWaitingMessageFrom(OWNER, SESSION, OWNER)).toBe(true)
  await clearPendingUserMessages(OWNER, SESSION)
  // After the turn, the report runs as its own turn.
  await queue(report)
  await startQueuedTurn(OWNER, SESSION)
  expect(runs).toHaveLength(1)
  expect(runs[0]?.source).toBe('agent.thread')
  expect(await waiting()).toEqual([])
})

test('after a restart the backstop starts a waiting queue, at most once per interval', async () => {
  const started: string[] = []

  installQueuedTurnStarter(async (_userId, sessionId) => {
    started.push(sessionId)
  })
  try {
    await enqueuePendingUserMessage(OWNER, 'backstop-session', human('left waiting'))
    await sweepQueuedSessions('0')
    await sweepQueuedSessions('0')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(started).toEqual(['backstop-session'])
  } finally {
    installQueuedTurnStarter(startQueuedTurn)
    await clearPendingUserMessages(OWNER, 'backstop-session')
  }
})

const REFUSED = 'refused-session'
const delivery = (messageId: string) =>
  startConversationTurn(
    { userId: OWNER, teamId: 'team', targetSessionId: REFUSED, messageId, locale: 'en' },
    { ...conversation, sessionId: REFUSED, claudeCodePreview: {} as never },
    'CI passed',
    'agent.thread',
    {} as never,
  )
const refusedWaiting = async () =>
  (await listPendingUserMessages(OWNER, REFUSED)).map((message) => message.id)

test('a delivery the runtime refuses mid-turn goes back to the queue and runs once it ends', async () => {
  installQueuedTurnStarter(startQueuedTurn)
  installTurnRunner({
    hasActiveAgentRunForSession: async () => false,
    claimAgentRunOrEnqueue: async () => ({
      mode: 'run',
      carried: [],
      release: () => {
        released++
        sessionReleased(OWNER, REFUSED)
      },
    }),
    claimAgentRunForSession: async () => () => {
      released++
    },
    runAgentForTrigger: async (args) => {
      runs.push(args)
      // A turn no backend run tracks, left by a replica that shut down.
      if (runs.length === 1) throw refusal('Running tools…')

      return { status: 'completed' }
    },
  })
  try {
    const { status, run } = await delivery('report')

    expect(status).toBe('started')
    await run
    await new Promise((resolve) => setTimeout(resolve, 50))
    // Not lost, and not restarted by the release that followed the refusal.
    expect(runs).toHaveLength(1)
    expect(await refusedWaiting()).toEqual(['report'])

    // The runtime's turn ends with no run to release the session; the retry starts it.
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    expect(runs.map((run) => run.messages.at(-1)?.id)).toEqual(['report', 'report'])
    expect(await refusedWaiting()).toEqual([])
  } finally {
    await clearPendingUserMessages(OWNER, REFUSED)
  }
})

test('a queued turn the runtime refuses after its check goes back to the front, not restarted', async () => {
  const later = agent('later')

  installQueuedTurnStarter(startQueuedTurn)
  installTurnRunner({
    hasActiveAgentRunForSession: async () => false,
    claimAgentRunForSession: async () => () => {
      released++
      sessionReleased(OWNER, REFUSED)
    },
    runAgentForTrigger: async (args) => {
      runs.push(args)
      if (runs.length > 1) return { status: 'completed' }
      // A continuation took the runtime after the check; a message arrives meanwhile.
      await enqueuePendingUserMessage(OWNER, REFUSED, later)
      throw refusal('Running tools…')
    },
  })
  try {
    const first = agent('first')

    await enqueuePendingUserMessage(OWNER, REFUSED, first)
    await startQueuedTurn(OWNER, REFUSED)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(runs).toHaveLength(1)
    expect(released).toBe(1)
    const queued = await listPendingUserMessages(OWNER, REFUSED)

    expect(queued.map((message) => message.id)).toEqual([first.id, later.id])
    expect(queued[0]?.attempts).toBe(1)
  } finally {
    await clearPendingUserMessages(OWNER, REFUSED)
  }
})

test('a send held for a sign-in waits while the ask is open, and runs as its sender once settled', async () => {
  signInRequest = {
    runtimeId: 'managed-1',
    requesterId: 'teammate',
    requesterName: 'Shant',
    askedUserIds: ['admin'],
    askedName: 'Bryan',
    askedAt: new Date(),
  }
  await queue(human('deploy it', 'teammate'))
  await startQueuedTurn(OWNER, SESSION)

  expect(launched).toHaveLength(0)
  expect(await waiting()).toEqual(['deploy it'])
  // The sign-in settles the ask (sign-in-settle) and releases the session.
  signInRequest = null
  await startQueuedTurn(OWNER, SESSION)

  expect(launched.map((item) => item.actorUserId)).toEqual(['teammate'])
  expect(await waiting()).toEqual([])
})

test('an ask older than the queue keeps messages no longer holds them', async () => {
  signInRequest = {
    runtimeId: 'managed-1',
    requesterId: 'teammate',
    requesterName: 'Shant',
    askedUserIds: ['admin'],
    askedName: 'Bryan',
    askedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  }
  await queue(human('later', 'teammate'))
  await startQueuedTurn(OWNER, SESSION)

  expect(launched).toHaveLength(1)
})

test('a conversation moved to another agent is not held by an ask about the old one', async () => {
  signInRequest = {
    runtimeId: 'managed-1',
    requesterId: 'teammate',
    requesterName: 'Shant',
    askedUserIds: ['admin'],
    askedName: 'Bryan',
    askedAt: new Date(),
  }
  conversationRuntime = 'managed-2'
  await queue(human('deploy it', 'teammate'))
  await startQueuedTurn(OWNER, SESSION)

  expect(launched.map((item) => item.actorUserId)).toEqual(['teammate'])
})
