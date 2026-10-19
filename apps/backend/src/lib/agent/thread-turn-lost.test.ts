import { afterEach, beforeEach, expect, test } from 'bun:test'

import { sessionsByConversation } from '@/lib/claude-code-preview/agent-chat-registry'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useIdentity } from '@/lib/test/doubles/identity'

import { UNDELIVERED_NOTICE } from './conversation-turn'
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
  userId: 'owner',
  teamId: 'team',
  title: 'Child',
  firstMessage: 'Original task',
  credentialAccess: { awsRoleIds: [] } as unknown as AgentCredentialAccess,
  agentRuntime: 'claude-code',
  runtimeId: 'runtime',
} as AgentConversation
const runs: Parameters<TurnRunner['runAgentForTrigger']>[0][] = []
let finishReasons: (string | undefined)[] = []

useIdentity({
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  signNuphosToken: () => 'test-token',
})
useConversationChatRoute({
  resolveConversationChatRuntime: async () => ({ runtime: 'claude-code' }),
})
useAgentDb({
  agentMessages: () => ({ findOne: async () => null }),
  getConversationBySessionId: async (id) => ({ ...conversation, sessionId: id }),
  getConversationWithMessages: async (id) => ({
    conversation: { ...conversation, sessionId: id },
    messages: [],
  }),
})

function attach(reattached: boolean | undefined, state = 'dormant') {
  sessionsByConversation.set('team:child', {
    openabSessionId: 'sess-1',
    ...(reattached === undefined ? {} : { reattached: Promise.resolve(reattached) }),
    client: { getSessionExecutionState: async () => ({ state }) },
  } as unknown as TeamSession)
}

/** Lets the report that follows the child's run finish. */
const settle = () => Bun.sleep(10)

beforeEach(() => {
  runs.length = 0
  finishReasons = ['connection-lost', 'stop']
  installTurnRunner({
    claimAgentRunOrEnqueue: async () => ({ mode: 'run', carried: [], release: () => {} }),
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
  await clearPendingUserMessages('owner', 'parent')
})

test('a thread turn lost to a runtime restart tells its sender, once', async () => {
  attach(true, 'dormant')
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs.map((run) => run.sessionId)).toEqual(['child', 'parent'])
  expect(runs[1]?.messages.at(-1)).toMatchObject({
    metadata: { source: 'agent.thread', sourceSessionId: 'child', sender: { type: 'system' } },
  })
  expect(JSON.stringify(runs[1]?.messages.at(-1)?.parts)).toContain('was cut off')
})

test('a reattach that did not bring the session back reports nothing', async () => {
  attach(false)
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs.map((run) => run.sessionId)).toEqual(['child'])
})

test('a lost notice is not reported back', async () => {
  attach(true, 'dormant')
  await (
    await startThreadTurn({ ...data, prompt: `${UNDELIVERED_NOTICE} earlier notice` })
  ).run
  await settle()

  expect(runs.map((run) => run.sessionId)).toEqual(['child'])
})

test('a live runtime that finished the turn while disconnected reports nothing', async () => {
  attach(true, 'idle')
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs.map((run) => run.sessionId)).toEqual(['child'])
})

test('a runtime still running the turn reports nothing', async () => {
  attach(true, 'active')
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs.map((run) => run.sessionId)).toEqual(['child'])
})

test('a turn that finished normally reports nothing', async () => {
  attach(true, 'dormant')
  finishReasons = ['stop']
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs.map((run) => run.sessionId)).toEqual(['child'])
})

test('no reattach in progress means nothing to report', async () => {
  attach(undefined)
  await (
    await startThreadTurn(data)
  ).run
  await settle()

  expect(runs.map((run) => run.sessionId)).toEqual(['child'])
})
