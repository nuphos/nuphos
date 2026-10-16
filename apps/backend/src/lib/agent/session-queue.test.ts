import { afterEach, beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { startQueuedTurn } from './conversation-turn'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from './pending-messages'
import { listPendingUserMessages, queueHead, requeueTurnQueue } from './pending-queue'
import { installQueuedTurnStarter, sessionReleased } from './session-released'
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

useIdentity({ signNuphosToken: () => 'test-token' })
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
    await queue(human('from a teammate', 'teammate'))
    sessionReleased(OWNER, SESSION)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(started).toEqual([SESSION])
  } finally {
    installQueuedTurnStarter(startQueuedTurn)
  }
})
