import { afterEach, beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { executeThreadTurn } from './thread-turn'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from './pending-messages'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AgentConversation, AgentCredentialAccess } from './db'
import type { ThreadTurn } from './thread-bridge'
import type { TurnRunner } from './turn-runner'

const data: ThreadTurn = {
  userId: 'owner',
  teamId: 'team',
  sessionId: 'source',
  targetSessionId: 'target',
  messageId: 'delivery',
  prompt: 'CI passed',
  locale: 'en',
}
const source = {
  sessionId: 'source',
  userId: 'owner',
  teamId: 'team',
  title: 'Original',
  firstMessage: 'Original task',
  credentialAccess: { awsRoleIds: [] } as unknown as AgentCredentialAccess,
  agentRuntime: 'codex',
  runtimeId: 'runtime',
} as AgentConversation
let alreadyAccepted = false
let released = 0
const runs: Parameters<TurnRunner['runAgentForTrigger']>[0][] = []
const claims: Parameters<TurnRunner['claimAgentRunOrEnqueue']>[0][] = []

useIdentity({
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  signNuphosToken: () => 'test-token',
})
useAgentDb({
  agentMessages: () =>
    ({ findOne: async () => (alreadyAccepted ? { _id: 'accepted' } : null) }) as never,
  getConversationBySessionId: async (id) => ({ ...source, sessionId: id }),
  getConversationWithMessages: async () => ({
    conversation: { ...source, sessionId: 'target' },
    messages: [
      {
        messageId: alreadyAccepted ? 'delivery' : 'prior',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Earlier result' }],
      },
    ],
  }),
})

beforeEach(() => {
  alreadyAccepted = false
  released = 0
  runs.length = 0
  claims.length = 0
  installTurnRunner({
    claimAgentRunOrEnqueue: async (args) => {
      claims.push(args)

      return {
        mode: 'run',
        carried: [],
        release: () => {
          released++
        },
      }
    },
    runAgentForTrigger: async (args) => {
      runs.push(args)

      return { status: 'completed' }
    },
  })
})
afterEach(async () => {
  resetTurnRunner()
  await clearPendingUserMessages('owner', 'target')
})

test('idle target wakes through the normal runner and keeps transcript, actor and approvals', async () => {
  await executeThreadTurn(data)
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({
    userId: 'owner',
    teamId: 'team',
    sessionId: 'target',
    origin: 'user',
  })
  expect(runs[0]?.messages).toHaveLength(2)
  expect(runs[0]?.messages[0]?.id).toBe('prior')
  expect(JSON.stringify(runs[0]?.messages[1])).toContain('not a new human instruction or approval')
  expect(claims[0]?.message.id).toBe('delivery')
  expect(released).toBe(1)
})

test('busy target queues without blocking the sending thread or starting a second run', async () => {
  installTurnRunner({
    claimAgentRunOrEnqueue: async (args) => {
      claims.push(args)

      return { mode: 'queued' }
    },
    runAgentForTrigger: async (args) => {
      runs.push(args)

      return { status: 'completed' }
    },
  })
  await executeThreadTurn(data)
  expect(claims[0]?.message.renderedText).toContain('CI passed')
  expect(runs).toHaveLength(0)
})

test('recovered pending messages include the delivery exactly once', async () => {
  installTurnRunner({
    claimAgentRunOrEnqueue: async (args) => ({
      mode: 'run',
      carried: [args.message],
      release: () => {
        released++
      },
    }),
    runAgentForTrigger: async (args) => {
      runs.push(args)

      return { status: 'completed' }
    },
  })
  await executeThreadTurn(data)
  expect(JSON.stringify(runs[0]?.messages).match(/CI passed/g)).toHaveLength(1)
})

test('redelivery of an already accepted message does not repeat work', async () => {
  alreadyAccepted = true
  await executeThreadTurn(data)
  expect(runs).toHaveLength(0)
  expect(claims).toHaveLength(0)
})

test('redelivery already queued on a busy target does not enqueue twice', async () => {
  await enqueuePendingUserMessage('owner', 'target', {
    ...buildPendingUserMessage({ renderedText: 'CI passed', source: 'agent.thread' }),
    id: data.messageId,
  })
  await executeThreadTurn(data)
  expect(claims).toHaveLength(0)
  expect(runs).toHaveLength(0)
})

test('runner failure releases the claim and fails the durable job', async () => {
  installTurnRunner({
    claimAgentRunOrEnqueue: async () => ({
      mode: 'run',
      carried: [],
      release: () => {
        released++
      },
    }),
    runAgentForTrigger: async () => ({ status: 'failed' }),
  })
  await expect(executeThreadTurn(data)).rejects.toThrow('Thread run failed')
  expect(released).toBe(1)
})

test('full pending queue is an error, not a delivery receipt', async () => {
  installTurnRunner({ claimAgentRunOrEnqueue: async () => ({ mode: 'dropped' }) })
  await expect(executeThreadTurn(data)).rejects.toThrow('could not be queued')
})
