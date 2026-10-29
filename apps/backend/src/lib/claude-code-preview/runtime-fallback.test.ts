import { beforeEach, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useConversationRuntimeMove } from '@/lib/test/doubles/conversation-runtime-move'
import { useModels } from '@/lib/test/doubles/models'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeQuota } from './runtime-quota'
import type { AgentConversation } from '@/lib/agent/db'

const TEAM_ID = '69e989027ab63e8d6a0ffcb6'
const HOUR = 60 * 60_000

let list: string[]
let conversation: AgentConversation
let usedPercent: Record<string, number>
let offline: boolean
let offlineCode: string
let refusals: Record<string, string>
let moves: { to: string; reason?: string; claimed?: boolean }[]
let updates: Record<string, unknown>[]
let instances: RuntimeInstance[]

const instance = (id: string, extra: Partial<RuntimeInstance> = {}): RuntimeInstance => ({
  id,
  provider: 'claude-code',
  label: `Agent ${id}`,
  status: 'active',
  kind: 'managed',
  createdAt: '',
  ...extra,
})
const computer = (id: string, extra: Partial<NonNullable<RuntimeInstance['local']>> = {}) =>
  instance(id, {
    kind: 'local',
    local: { ...({} as NonNullable<RuntimeInstance['local']>), ...extra },
  })
const quota = (runtimeId: string, used: number, resetsAt: string | null = null): RuntimeQuota => ({
  runtimeId,
  provider: 'claude-code',
  fetchedAt: '',
  available: true,
  windows: [{ id: 'five_hour', label: '5-hour', usedPercent: used, resetsAt }],
})

useModels({
  userTeamRuntimeFallbacks: () => ({ findOne: async () => ({ runtimeIds: list }) }),
})
useAgentDb({
  getConversationBySessionId: async () => conversation,
  agentConversations: () => ({
    updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
      updates.push(update)
    },
  }),
})
useRuntimeCatalog({
  listRuntimeInstances: async () => instances,
  listRuntimeQuotas: async (_teamId: string, instances: RuntimeInstance[]) =>
    instances.map((entry) => quota(entry.id, usedPercent[entry.id] ?? 0)),
})
useConversationChatRoute({
  resolveConversationChatRuntime: async () => {
    if (offline) throw new AppError(503, offlineCode, 'Offline')

    return {}
  },
})
useConversationRuntimeMove({
  moveConversationRuntime: async (
    _conversation: AgentConversation,
    to: string,
    _mode: string,
    _userId: string,
    options: { reason?: string; claimed?: boolean } = {},
  ) => {
    if (refusals[to]) throw new AppError(409, refusals[to], `${to} refused`)
    moves.push({ to, ...options })
    conversation = { ...conversation, runtimeId: to }

    return {}
  },
})

const { fallBackAfterFailure, fallBackBeforeTurn, lowOnUsage } = await import('./runtime-fallback')

beforeEach(() => {
  list = ['b', 'c']
  usedPercent = {}
  offline = false
  offlineCode = 'runtime_offline'
  instances = ['a', 'b', 'c'].map((id) => instance(id))
  refusals = {}
  moves = []
  updates = []
  conversation = {
    sessionId: 'session',
    userId: 'owner',
    teamId: TEAM_ID,
    runtimeId: 'a',
  } as AgentConversation
})

const stops = () =>
  updates.flatMap((update) => {
    const push = update.$push as { timelineEvents?: { $each: unknown[] } } | undefined

    return push?.timelineEvents?.$each ?? []
  })

test('a window under 10% counts as low unless it resets within 30 minutes', () => {
  const now = Date.parse('2026-10-29T00:00:00Z')

  expect(lowOnUsage(quota('a', 95, '2026-10-29T03:00:00Z'), now)).toBe(true)
  expect(lowOnUsage(quota('a', 95, '2026-10-29T00:10:00Z'), now)).toBe(false)
  expect(lowOnUsage(quota('a', 85), now)).toBe(false)
  expect(lowOnUsage({ ...quota('a', 100), available: false }, now)).toBe(false)
})

test('without a fallback list nothing is checked or moved', async () => {
  list = []
  offline = true

  expect(await fallBackBeforeTurn(conversation, 'owner')).toBe(conversation)
  expect(moves).toEqual([])
})

test('a healthy agent with usage left keeps the conversation', async () => {
  expect(await fallBackBeforeTurn(conversation, 'owner')).toBe(conversation)
  expect(moves).toEqual([])
})

test('an agent low on usage moves to the first listed agent that is not', async () => {
  usedPercent = { a: 95, b: 99 }

  const moved = await fallBackBeforeTurn(conversation, 'owner', true)

  expect(moved?.runtimeId).toBe('c')
  expect(moves).toEqual([{ to: 'c', reason: 'quota', claimed: true }])
  expect(stops()).toEqual([])
})

test('an unreachable agent moves, passing over agents the move refuses', async () => {
  offline = true
  refusals = { b: 'runtime_offline' }

  expect((await fallBackBeforeTurn(conversation, 'owner'))?.runtimeId).toBe('c')
  expect(moves).toEqual([{ to: 'c', reason: 'offline', claimed: false }])
})

test('a busy conversation stays put without a stop notice', async () => {
  offline = true
  refusals = { b: 'conversation_busy' }

  expect(await fallBackBeforeTurn(conversation, 'owner')).toBe(conversation)
  expect(moves).toEqual([])
  expect(stops()).toEqual([])
})

test('a failed turn records its agent and moves on down the list', async () => {
  await fallBackAfterFailure(
    'session',
    new AppError(503, 'claude_code_runtime_unavailable', ''),
    'owner',
  )

  expect(moves).toEqual([{ to: 'b', reason: 'failure', claimed: true }])
  expect(updates[0]).toMatchObject({ $set: { runtimeFallback: { failed: ['a'] } } })
})

test('agents that failed within the hour are skipped, and the stop says why', async () => {
  conversation = { ...conversation, runtimeFallback: { failed: ['b'], at: new Date() } }
  usedPercent = { c: 99 }

  await fallBackAfterFailure('session', new AppError(503, 'runtime_offline', ''), 'owner')

  expect(moves).toEqual([])
  expect(stops()).toMatchObject([
    {
      kind: 'runtime_fallback_stopped',
      skipped: [
        { label: 'Agent b', reason: 'failed recently' },
        { label: 'Agent c', reason: 'low on usage' },
      ],
    },
  ])
})

test('a failure older than an hour no longer blocks that agent', async () => {
  conversation = {
    ...conversation,
    runtimeFallback: { failed: ['b'], at: new Date(Date.now() - 2 * HOUR) },
  }

  await fallBackAfterFailure('session', new AppError(503, 'runtime_offline', ''), 'owner')

  expect(moves.map((move) => move.to)).toEqual(['b'])
})

test('a failure that is not the agent’s does not move the conversation', async () => {
  await fallBackAfterFailure('session', new Error('The model refused'), 'owner')

  expect(moves).toEqual([])
  expect(updates).toEqual([])
})

test('a teammate’s turn only falls back to hosted agents, never the owner’s computer', async () => {
  offline = true
  instances = [instance('a'), computer('b'), instance('c', { kind: 'external' }), instance('d')]
  list = ['b', 'c', 'd']

  expect((await fallBackBeforeTurn(conversation, 'teammate'))?.runtimeId).toBe('d')
  expect(moves.map((move) => move.to)).toEqual(['d'])
})

test('the owner falls back to their own computer, but not to a teammate’s shared one', async () => {
  offline = true
  instances = [instance('a'), computer('b', { shared: { level: 'full' } }), computer('c')]

  expect((await fallBackBeforeTurn(conversation, 'owner'))?.runtimeId).toBe('c')
})

test('an asleep Box is woken by the turn rather than left behind', async () => {
  offline = true
  instances = [computer('a', { box: { provider: 'instabox' } as never }), instance('b')]

  expect(await fallBackBeforeTurn(conversation, 'owner')).toBe(conversation)
  await fallBackAfterFailure('session', new AppError(503, 'runtime_offline', ''), 'owner')
  expect(moves).toEqual([])
})

test('an agent that is still starting is waited for, not moved away from', async () => {
  offline = true
  offlineCode = 'claude_code_runtime_starting'

  expect(await fallBackBeforeTurn(conversation, 'owner')).toBe(conversation)
  expect(moves).toEqual([])
})
