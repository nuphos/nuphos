import { afterEach, beforeEach, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useBoxWake } from '@/lib/test/doubles/box-wake'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useIdentity } from '@/lib/test/doubles/identity'

import { UNDELIVERED_NOTICE } from './conversation-turn'
import { parseMessageMetadata } from './message-metadata'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
  hasPendingUserMessages,
} from './pending-messages'
import { startQueuedTurn } from './queued-turn'
import { startThreadTurn } from './thread-bridge'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AgentConversation, AgentCredentialAccess } from './db'
import type { ThreadTurn } from './thread-bridge'
import type { TurnRunner } from './turn-runner'

// Every accepted thread message either runs as a turn of its target or its
// sender hears, once, that it did not. A target that cannot run at all is an
// error before any receipt.

const data: ThreadTurn = {
  userId: 'owner',
  teamId: 'team',
  sessionId: 'source',
  targetSessionId: 'target',
  messageId: 'delivery',
  prompt: 'Handed back: PR is green',
  locale: 'en',
}
const base = {
  userId: 'owner',
  teamId: 'team',
  title: 'Thread',
  firstMessage: 'Original task',
  credentialAccess: { awsRoleIds: [] } as unknown as AgentCredentialAccess,
  agentRuntime: 'claude-code',
  runtimeId: 'runtime',
} as AgentConversation
// The one conversation, if any, that reads as archived.
let archived: string | null = null
let deleted = false
let runtimeError: Error | null = null
let boxResuming = false
let claims = 0
const runs: Parameters<TurnRunner['runAgentForTrigger']>[0][] = []

useIdentity({
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  signNuphosToken: () => 'test-token',
})
useConversationChatRoute({
  resolveConversationChatRuntime: async () => {
    if (runtimeError) throw runtimeError

    return { runtime: 'claude-code' }
  },
})
useBoxWake({ wakeOfflineBox: async () => boxResuming })
useAgentDb({
  agentMessages: () => ({ findOne: async () => null }),
  getConversationBySessionId: async (id) =>
    deleted && id === 'target'
      ? null
      : {
          ...base,
          sessionId: id,
          ...(archived === id ? { archivedAt: new Date() } : {}),
        },
  getConversationWithMessages: async (id) => ({
    conversation: { ...base, sessionId: id },
    messages: [],
  }),
})

/** The sender's notice runs as its own turn, which nothing awaits. */
const settle = () => Bun.sleep(10)
const notices = () => runs.filter((run) => run.sessionId === 'source')
const noticeText = () => JSON.stringify(notices()[0]?.messages.at(-1)?.parts)

function threadMessage(receivedAt = new Date().toISOString()) {
  return {
    ...buildPendingUserMessage({
      renderedText: 'Handed back: PR is green',
      source: 'agent.thread',
      actorUserId: 'owner',
      metadata: {
        version: 1,
        sender: { type: 'agent', id: 'source', displayName: 'Source' },
        source: 'agent.thread',
        sourceSessionId: 'source',
        sentAt: receivedAt,
      },
    }),
    receivedAt,
  }
}

beforeEach(() => {
  archived = null
  deleted = false
  runtimeError = null
  boxResuming = false
  claims = 0
  runs.length = 0
  installTurnRunner({
    claimAgentRunOrEnqueue: async () => {
      claims++

      return { mode: 'run', carried: [], release: () => {} }
    },
    claimAgentRunForSession: async () => () => {},
    hasActiveAgentRunForSession: async () => false,
    runAgentForTrigger: async (args) => {
      runs.push(args)

      return { status: 'completed' }
    },
  })
})
afterEach(async () => {
  resetTurnRunner()
  await clearPendingUserMessages('owner', 'target')
  await clearPendingUserMessages('owner', 'source')
})

for (const [name, error] of [
  [
    'a removed runtime',
    new AppError(404, 'runtime_not_found', 'This agent is no longer available in this workspace.'),
  ],
  [
    'a signed-out runtime',
    new AppError(409, 'runtime_login_required', 'Sign in to Claude Code on the computer.'),
  ],
  [
    'an offline computer',
    new AppError(409, 'runtime_offline', 'The computer running this agent is offline.'),
  ],
] as const) {
  test(`${name} is the sender's error, not a "started" receipt`, async () => {
    runtimeError = error

    await expect(startThreadTurn(data)).rejects.toThrow(
      `The target thread cannot run: ${error.message} Move it to a running agent`,
    )
    expect(claims).toBe(0)
    expect(runs).toHaveLength(0)
  })
}

test('an offline Box is woken and the sender told to resend shortly', async () => {
  runtimeError = new AppError(409, 'runtime_offline', 'The computer running this agent is offline.')
  boxResuming = true

  await expect(startThreadTurn(data)).rejects.toThrow('Box that is resuming')
  expect(claims).toBe(0)
})

test('a started turn that fails tells its sender, once', async () => {
  installTurnRunner({
    claimAgentRunOrEnqueue: async () => ({ mode: 'run', carried: [], release: () => {} }),
    runAgentForTrigger: async (args) => {
      runs.push(args)
      if (args.sessionId === 'target') throw new Error('Runtime went away mid-turn.')

      return { status: 'completed' }
    },
  })

  const { status, run } = await startThreadTurn(data)

  expect(status).toBe('started')
  await expect(run).rejects.toThrow('Runtime went away mid-turn.')
  await settle()
  expect(notices()).toHaveLength(1)
  expect(notices()[0]?.messages.at(-1)?.metadata).toMatchObject({
    source: 'agent.thread',
    sourceSessionId: 'target',
    sender: { type: 'agent' },
  })
  // An attribution the parser rejects renders as the owner's own message.
  expect(parseMessageMetadata(notices()[0]?.messages.at(-1)?.metadata)).toBeDefined()
  expect(noticeText()).toContain(UNDELIVERED_NOTICE)
  expect(noticeText()).toContain('did not run: Runtime went away mid-turn.')
  expect(noticeText()).toContain('Handed back: PR is green')
})

test('a queued message whose turn fails tells its sender', async () => {
  installTurnRunner({
    claimAgentRunForSession: async () => () => {},
    hasActiveAgentRunForSession: async () => false,
    claimAgentRunOrEnqueue: async () => ({ mode: 'run', carried: [], release: () => {} }),
    runAgentForTrigger: async (args) => {
      runs.push(args)
      if (args.sessionId === 'target') return { status: 'failed' }

      return { status: 'completed' }
    },
  })
  await enqueuePendingUserMessage('owner', 'target', threadMessage())

  await expect(startQueuedTurn('owner', 'target')).rejects.toThrow('Thread run failed')
  await settle()
  expect(notices()).toHaveLength(1)
  expect(noticeText()).toContain('did not run: Thread run failed')
})

test('an archived sender is still told, and its notice turn restores it', async () => {
  installTurnRunner({
    claimAgentRunForSession: async () => () => {},
    hasActiveAgentRunForSession: async () => false,
    claimAgentRunOrEnqueue: async () => ({ mode: 'run', carried: [], release: () => {} }),
    runAgentForTrigger: async (args) => {
      runs.push(args)
      if (args.sessionId === 'target') return { status: 'failed' }

      return { status: 'completed' }
    },
  })
  await enqueuePendingUserMessage('owner', 'target', threadMessage())
  archived = 'source'

  await expect(startQueuedTurn('owner', 'target')).rejects.toThrow('Thread run failed')
  await settle()
  expect(notices()).toHaveLength(1)
  expect(notices()[0]?.origin).toBe('user')
  expect(noticeText()).toContain('did not run: Thread run failed')
})

test("a message queued before its thread was archived runs as the thread's turn", async () => {
  await enqueuePendingUserMessage('owner', 'target', threadMessage())
  archived = 'target'

  await startQueuedTurn('owner', 'target')
  await settle()
  expect(await hasPendingUserMessages('owner', 'target')).toBe(false)
  expect(runs.map(({ sessionId, origin }) => ({ sessionId, origin }))).toEqual([
    { sessionId: 'target', origin: 'user' },
  ])
})

test('a message left in a queue that never runs is dropped before its TTL and reported', async () => {
  await enqueuePendingUserMessage(
    'owner',
    'target',
    threadMessage(new Date(Date.now() - 60 * 60 * 1000).toISOString()),
  )

  await startQueuedTurn('owner', 'target')
  await settle()
  expect(await hasPendingUserMessages('owner', 'target')).toBe(false)
  expect(runs.map((run) => run.sessionId)).toEqual(['source'])
  expect(noticeText()).toContain('was dropped after waiting an hour')
})

for (const [name, receivedAt] of [
  ['fresh', () => new Date().toISOString()],
  ['expired', () => new Date(Date.now() - 60 * 60 * 1000).toISOString()],
] as const) {
  test(`a ${name} message queued for a deleted thread tells its sender exactly once`, async () => {
    deleted = true
    await enqueuePendingUserMessage('owner', 'target', threadMessage(receivedAt()))

    await startQueuedTurn('owner', 'target')
    await startQueuedTurn('owner', 'target')
    await settle()
    expect(await hasPendingUserMessages('owner', 'target')).toBe(false)
    expect(runs.map((run) => run.sessionId)).toEqual(['source'])
    expect(runs[0]).toMatchObject({ teamId: 'team', userId: 'owner' })
  })
}

test('a notice that does not run is not reported back', async () => {
  installTurnRunner({
    claimAgentRunOrEnqueue: async () => ({ mode: 'run', carried: [], release: () => {} }),
    runAgentForTrigger: async (args) => {
      runs.push(args)

      return { status: 'failed' }
    },
  })

  const { run } = await startThreadTurn({ ...data, prompt: `${UNDELIVERED_NOTICE} earlier` })

  await expect(run).rejects.toThrow('Thread run failed')
  await settle()
  expect(runs.map((entry) => entry.sessionId)).toEqual(['target'])
})
