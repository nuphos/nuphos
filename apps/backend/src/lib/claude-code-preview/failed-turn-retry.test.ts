import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'
import { useRedis } from '@/lib/test/doubles/redis'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { moveConversationRuntime } from './conversation-runtime-move'
import { failedPrompt } from './failed-turn-retry'

import type { AgentConversation, AgentMessage } from '@/lib/agent/db/shared'
import type { MessageMetadata } from '@/lib/agent/message-metadata'

const sender = (id: string, type: 'user' | 'agent' = 'user'): MessageMetadata => ({
  version: 1,
  sender: { type, id, displayName: id },
  ...(type === 'user' ? { source: 'nuphos' } : { source: 'agent.thread', sourceSessionId: 'cto' }),
  sentAt: '2026-11-16T00:00:00.000Z',
})
const asked = (text: string, metadata: MessageMetadata = sender('owner'), parts?: unknown[]) =>
  ({ role: 'user', parts: parts ?? [{ type: 'text', text }], metadata }) as AgentMessage
const failed = (...extra: unknown[]) =>
  ({
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      ...extra,
      { type: 'turn-interrupted', id: 'x', reason: 'error', message: 'Out', cause: 'usage_limit' },
    ],
  }) as AgentMessage

test('a turn the runtime refused before doing anything is resent', () => {
  expect(failedPrompt([asked('Fix it'), failed()], 'owner')).toMatchObject({
    text: 'Fix it',
    metadata: { sender: { id: 'owner' } },
  })
  // An agent's message to the owner's thread runs as the owner anyway.
  expect(failedPrompt([asked('Do it', sender('cto', 'agent')), failed()], 'owner')?.text).toBe(
    'Do it',
  )
})

test('anything else is left alone', () => {
  const other = { type: 'turn-interrupted', id: 'x', reason: 'error', message: 'Bug' }
  const cancelled = { type: 'turn-interrupted', id: 'x', reason: 'cancelled', message: 'Stopped' }

  // Output or tool calls may have done something already.
  expect(
    failedPrompt([asked('Fix it'), failed({ type: 'text', text: 'Looking' })], 'owner'),
  ).toBeNull()
  expect(
    failedPrompt([asked('Fix it'), failed({ type: 'tool', toolCallId: 't' })], 'owner'),
  ).toBeNull()
  // Not the runtime's fault, or stopped by a person.
  for (const part of [other, cancelled])
    expect(
      failedPrompt(
        [asked('Fix it'), { role: 'assistant', parts: [part] } as AgentMessage],
        'owner',
      ),
    ).toBeNull()
  // A teammate's prompt would run as the owner; one with a file is more than its text.
  expect(failedPrompt([asked('Fix it', sender('mate')), failed()], 'owner')).toBeNull()
  const file = [
    { type: 'text', text: 'See' },
    { type: 'file', url: 'x' },
  ]

  expect(failedPrompt([asked('See', sender('owner'), file), failed()], 'owner')).toBeNull()
  // The last turn answered fine.
  expect(failedPrompt([asked('Hi'), { role: 'assistant', parts: [] } as never], 'owner')).toBeNull()
})

let memory = portabilityDb()
let messages: AgentMessage[] = []
let sent: { text: string; runtimeId?: string }[] = []

useDb({ db: () => memory })
useRedis({ redisEnabled: () => true })
useAgentRunStore({
  getActiveAgentRunForSession: async () => null,
  reserveActiveAgentRunForSession: async () => async () => {},
})
useRuntimeModels({ runtimeModelCatalog: async () => ({ models: [] }) as never })
useRuntimeCatalog({
  requireRuntimeInstance: async () =>
    ({ id: 'new', provider: 'codex', label: 'Codex', status: 'active', kind: 'managed' }) as never,
  developmentRuntimeEndpoint: () => {},
})
useRuntimeRegistry({
  findHostedRuntime: async () => null,
  resolveTeamRuntimeEndpoints: async () => [{ runtimeId: 'new', url: 'wss://new', authKey: 'k' }],
})
useAgentDb({
  getConversationMessages: async () => messages,
  getConversationBySessionId: async (sessionId: string) =>
    (memory.rows('agent_conversations') as AgentConversation[]).find(
      (row) => row.sessionId === sessionId,
    ) ?? null,
})
useConversationTurn({
  startConversationTurn: async (_data, target, text) => {
    sent.push({ text, runtimeId: target.runtimeId })

    return { status: 'started', run: Promise.resolve(undefined) }
  },
})

const conversation = (): AgentConversation => ({
  sessionId: 's',
  userId: 'owner',
  teamId: 'team',
  title: '',
  firstMessage: '',
  messageCount: 2,
  createdAt: new Date(),
  lastActiveAt: new Date(),
  agentRuntime: 'claude-code',
  runtimeId: 'old',
  runtimeLabel: 'Claude Code',
})

beforeEach(() => {
  memory = portabilityDb()
  memory.rows('agent_conversations').push(conversation())
  sent = []
})

test('a person’s move resends the failed turn once on the new runtime, and says so', async () => {
  messages = [asked('Fix it'), failed()]
  await moveConversationRuntime(conversation(), 'new', 'owner')
  await Bun.sleep(0)

  expect(sent).toEqual([{ text: 'Fix it', runtimeId: 'new' }])
  expect(memory.rows('agent_conversations')[0]?.timelineEvents).toMatchObject([
    { kind: 'runtime_moved', toLabel: 'Codex', retrying: true },
  ])
})

test('a fallback move keeps its own continuation; a move after a good turn resends nothing', async () => {
  messages = [asked('Fix it'), failed()]
  await moveConversationRuntime(conversation(), 'new', 'owner', { reason: 'failure' })
  memory = portabilityDb()
  memory.rows('agent_conversations').push(conversation())
  messages = [asked('Hi'), { role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] } as never]
  await moveConversationRuntime(conversation(), 'new', 'owner')
  await Bun.sleep(0)

  expect(sent).toEqual([])
  expect(memory.rows('agent_conversations')[0]?.timelineEvents?.[0]).not.toHaveProperty('retrying')
})
