import { afterEach, beforeEach, expect, test } from 'bun:test'

import { sessionsByConversation } from '@/lib/claude-code-preview/agent-chat-registry'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { LOST_TURN_PROMPT } from './conversation-turn'
import { clearPendingUserMessages } from './pending-messages'
import { startThreadTurn } from './thread-bridge'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AgentConversation, AgentCredentialAccess } from './db'
import type { ThreadTurn } from './thread-bridge'
import type { TurnRunner } from './turn-runner'
import type { TeamSession } from '@/lib/claude-code-preview/team-openab-runtime'

const data: ThreadTurn = {
  userId: 'owner',
  teamId: 'team',
  sessionId: 'parent',
  targetSessionId: 'child',
  messageId: 'delivery',
  prompt: 'run the tests',
  locale: 'en',
}
const conversation = {
  sessionId: 'parent',
  userId: 'owner',
  teamId: 'team',
  firstMessage: 'Original task',
  credentialAccess: { awsRoleIds: [] } as unknown as AgentCredentialAccess,
  agentRuntime: 'claude-code',
  runtimeId: 'runtime',
} as AgentConversation
const runs: Parameters<TurnRunner['runAgentForTrigger']>[0][] = []
let finishReasons: (string | undefined)[] = []
let released = 0

useIdentity({
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  signNuphosToken: () => 'test-token',
})
useAgentDb({
  agentMessages: () => ({ findOne: async () => null }),
  getConversationBySessionId: async (id) => ({ ...conversation, sessionId: id }),
  getConversationWithMessages: async () => ({
    conversation: { ...conversation, sessionId: 'child' },
    messages: [],
  }),
})

function attach(reattached: boolean, state: string) {
  sessionsByConversation.set('team:child', {
    openabSessionId: 'sess-1',
    reattached: Promise.resolve(reattached),
    client: { getSessionExecutionState: async () => ({ state }) },
  } as unknown as TeamSession)
}

/** Lets the fire-and-forget continuation run to completion. */
const settle = () => Bun.sleep(10)

beforeEach(() => {
  runs.length = 0
  released = 0
  finishReasons = ['connection-lost', 'stop']
  installTurnRunner({
    claimAgentRunOrEnqueue: async () => ({
      mode: 'run',
      carried: [],
      release: () => {
        released++
      },
    }),
    runAgentForTrigger: async (args) => {
      runs.push(args)

      return { status: 'completed', finishReason: finishReasons.shift() }
    },
  })
})
afterEach(async () => {
  resetTurnRunner()
  sessionsByConversation.delete('team:child')
  await clearPendingUserMessages('owner', 'child')
})

test('a thread turn whose runtime died continues once the session is back and idle', async () => {
  attach(true, 'idle')
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs).toHaveLength(2)
  expect(runs[1]?.messages.at(-1)).toMatchObject({
    id: 'delivery:continued',
    metadata: { source: 'agent.thread', sourceSessionId: 'parent' },
    parts: [{ type: 'text', text: LOST_TURN_PROMPT }],
  })
  expect(released).toBe(2)
})

test('a runtime still running the turn keeps it; nothing is sent', async () => {
  attach(true, 'active')
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs).toHaveLength(1)
})

test('a session that never came back is not prompted', async () => {
  attach(false, 'idle')
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs).toHaveLength(1)
})

test('a continuation lost again is not continued', async () => {
  attach(true, 'idle')
  finishReasons = ['connection-lost', 'connection-lost', 'stop']
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs).toHaveLength(2)
})

test('a turn that finished normally is not continued', async () => {
  attach(true, 'idle')
  finishReasons = ['stop']
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs).toHaveLength(1)
})
