import { afterEach, beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { executeConversationTurn } from './conversation-turn'
import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from './pending-messages'
import { startThreadTurn } from './thread-bridge'
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
const acceptedIds = new Set<string>()
let alreadyAccepted = false
let released = 0
const runs: Parameters<TurnRunner['runAgentForTrigger']>[0][] = []
const claims: Parameters<TurnRunner['claimAgentRunOrEnqueue']>[0][] = []

useIdentity({
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  signNuphosToken: () => 'test-token',
})
useAgentDb({
  agentMessages: () => ({
    findOne: async ({ messageId }: { messageId: string }) =>
      alreadyAccepted || acceptedIds.has(messageId) ? { _id: 'accepted' } : null,
  }),
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
  acceptedIds.clear()
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
  const { status, run } = await startThreadTurn(data)

  expect(status).toBe('started')
  await run
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({
    userId: 'owner',
    teamId: 'team',
    sessionId: 'target',
    origin: 'user',
  })
  expect(runs[0]?.messages).toHaveLength(2)
  expect(runs[0]?.messages[0]?.id).toBe('prior')
  expect(runs[0]?.messages[1]).toMatchObject({
    metadata: {
      sender: { type: 'agent', id: 'source' },
      source: 'agent.thread',
      sourceSessionId: 'source',
    },
    parts: [{ type: 'text', text: 'CI passed' }],
  })
  expect(runs[0]?.messages[1]?.metadata).toEqual(claims[0]?.message.metadata)
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
  expect((await startThreadTurn(data)).status).toBe('delivered')
  expect(claims[0]?.message.renderedText).toBe('CI passed')
  expect(claims[0]?.message.metadata?.sourceSessionId).toBe('source')
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
  await (
    await startThreadTurn(data)
  ).run
  expect(JSON.stringify(runs[0]?.messages).match(/CI passed/g)).toHaveLength(1)
  expect(runs[0]?.messages[1]?.metadata).toMatchObject({
    source: 'agent.thread',
    sourceSessionId: 'source',
  })
})

test('redelivery of an already accepted message does not repeat work', async () => {
  alreadyAccepted = true
  await (
    await startThreadTurn(data)
  ).run
  expect(runs).toHaveLength(0)
  expect(claims).toHaveLength(0)
})

test('redelivery already queued on a busy target does not enqueue twice', async () => {
  await enqueuePendingUserMessage('owner', 'target', {
    ...buildPendingUserMessage({ renderedText: 'CI passed', source: 'agent.thread' }),
    id: data.messageId,
  })
  await (
    await startThreadTurn(data)
  ).run
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
  await expect(startThreadTurn(data).then(({ run }) => run)).rejects.toThrow('Thread run failed')
  expect(released).toBe(1)
})

test('full pending queue is an error, not a delivery receipt', async () => {
  installTurnRunner({ claimAgentRunOrEnqueue: async () => ({ mode: 'dropped' }) })
  await expect(startThreadTurn(data).then(({ run }) => run)).rejects.toThrow('could not be queued')
})

test('recovered batch preserves every delivery ID and metadata across redelivery', async () => {
  const earlier = {
    ...buildPendingUserMessage({
      renderedText: 'Earlier delegated task',
      source: 'agent.thread',
      actorUserId: 'owner',
      metadata: {
        version: 1,
        sender: { type: 'user', id: 'owner', displayName: 'Owner' },
        source: 'nuphos',
        sentAt: '2026-10-06T00:00:00Z',
      },
    }),
    id: 'earlier-delivery',
  }

  installTurnRunner({
    claimAgentRunOrEnqueue: async (args) => {
      claims.push(args)

      return {
        mode: 'run',
        carried: [earlier, args.message],
        release: () => {
          released++
        },
      }
    },
    runAgentForTrigger: async (args) => {
      runs.push(args)
      // Model the runner's accepted-transcript persistence by stable message ID.
      for (const message of args.messages) acceptedIds.add(message.id)

      return { status: 'completed' }
    },
  })
  await (
    await startThreadTurn(data)
  ).run
  await (
    await startThreadTurn({ ...data, messageId: earlier.id, prompt: earlier.renderedText })
  ).run
  await (
    await startThreadTurn(data)
  ).run
  expect(runs).toHaveLength(1)
  expect(claims).toHaveLength(1)
  expect(released).toBe(1)
  expect(runs[0]?.messages.map((message) => message.id)).toEqual([
    'prior',
    earlier.id,
    data.messageId,
  ])
  expect(runs[0]?.messages[1]).toMatchObject({
    role: 'user',
    metadata: earlier.metadata,
    parts: [{ type: 'text', text: earlier.renderedText }],
  })
})

test('resource events preserve approval handling and are marked autonomous', async () => {
  const metadata = {
    version: 1 as const,
    sender: { type: 'system' as const, id: 'github', displayName: 'GitHub' },
    source: 'agent.resource' as const,
    resourceUrl: 'https://github.com/nuphos/nuphos/pull/186',
    sentAt: '2026-10-11T00:00:00Z',
  }

  await executeConversationTurn(
    data,
    source,
    'GitHub check_suite.completed.',
    'agent.resource',
    metadata,
  )
  expect(runs[0]).toMatchObject({
    origin: 'trigger',
    source: 'agent.resource',
    sessionId: 'target',
  })
  expect(claims[0]?.message.source).toBe('agent.resource')
  expect(claims[0]?.message.metadata).toEqual(metadata)
  expect(runs[0]?.messages[1]).toMatchObject({
    metadata,
    parts: [{ type: 'text', text: 'GitHub check_suite.completed.' }],
  })
})
