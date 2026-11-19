import { beforeEach, expect, test } from 'bun:test'

import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useDb } from '@/lib/test/doubles/db'
import { useModels } from '@/lib/test/doubles/models'
import { useRedis } from '@/lib/test/doubles/redis'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { sessionsByConversation } from './agent-chat-registry'
import { moveConversationRuntime } from './conversation-runtime-move'
import { fallBackBeforeTurn } from './runtime-fallback'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeModelCatalog } from './runtime-models'
import type { TeamSession } from './team-openab-runtime'
import type { AgentConversation } from '@/lib/agent/db/shared'

let memory = portabilityDb()
let busy = false
let target: RuntimeInstance
let conversation: AgentConversation
const allModels = ['old-agent-model', 'chosen-model', 'latest-model']
let destinationModels: string[] | null = allModels
// What the destination reports running when nothing is picked; none by default.
let destinationDefaults: { modelId: string; defaultEffort?: string } = { modelId: 'default' }

useRuntimeModels({
  runtimeModelCatalog: async (): Promise<RuntimeModelCatalog> => {
    if (!destinationModels) throw new Error('catalog unreachable')

    return {
      models: destinationModels.map((id) => ({ id, name: id })),
      controls: {
        ...destinationDefaults,
        effort: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
        fast: [],
      },
    }
  },
})

useDb({ db: () => memory })
useRedis({ redisEnabled: () => true })
useAgentRunStore({
  getActiveAgentRunForSession: async () => (busy ? { streamId: 'active' } : null),
  reserveActiveAgentRunForSession: async () => async () => {},
})
useRuntimeCatalog({
  requireRuntimeInstance: async () => target,
  developmentRuntimeEndpoint: () => {},
})
useRuntimeRegistry({
  resolveTeamRuntimeEndpoints: async () => [
    { runtimeId: 'new', url: 'wss://new/acp', authKey: 'private' },
  ],
})
beforeEach(() => {
  memory = portabilityDb()
  busy = false
  destinationModels = allModels
  destinationDefaults = { modelId: 'default' }
  target = {
    id: 'new',
    provider: 'claude-code',
    label: 'New runtime',
    status: 'active',
    kind: 'managed',
    createdAt: '',
  }
  conversation = {
    sessionId: 'conversation',
    userId: 'owner',
    teamId: 'team',
    title: 'Keep title',
    firstMessage: 'Keep history',
    messageCount: 42,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    agentRuntime: 'claude-code',
    runtimeId: 'old',
    runtimeLabel: 'Old runtime',
    claudeCodePreview: {
      runtimeUrl: 'wss://old/acp',
      openabSessionId: 'native-old',
      runtimeDefaults: { effort: 'high' },
    },
    initialSessionConfig: { model: 'old-agent-model' },
  }
  memory.rows('agent_conversations').push(conversation)
})
test('moves the same conversation and keeps history and settings', async () => {
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation).toMatchObject({
    sessionId: 'conversation',
    title: 'Keep title',
    messageCount: 42,
    userId: 'owner',
    teamId: 'team',
    runtimeId: 'new',
  })
  // The session goes with the old placement; the next prompt creates one on the
  // destination.
  expect(conversation.claudeCodePreview).toBeUndefined()
  expect(conversation.runtimeOperation).toBeUndefined()
})
test('a move ends the old session on the runtime it leaves', async () => {
  const closed: string[] = []
  let observing = true
  const key = 'team:conversation'

  sessionsByConversation.set(key, {
    openabSessionId: 'native-old',
    client: {
      closeSession: async (id: string) => {
        closed.push(id)
      },
    },
    stopObserving: () => {
      observing = false
    },
  } as unknown as TeamSession)
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(closed).toEqual(['native-old'])
  expect(observing).toBe(false)
  expect(sessionsByConversation.has(key)).toBe(false)
})
test('a runtime that cannot close the old session does not fail the move', async () => {
  sessionsByConversation.set('team:conversation', {
    openabSessionId: 'native-old',
    client: { closeSession: () => Promise.reject(new Error('runtime offline')) },
  } as unknown as TeamSession)
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.runtimeId).toBe('new')
  expect(sessionsByConversation.has('team:conversation')).toBe(false)
})
test('a move records where the conversation came from', async () => {
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.runtimeMigration).toMatchObject({ fromRuntimeId: 'old', toRuntimeId: 'new' })
  expect(conversation.previousRuntimeUrls).toEqual(['wss://old/acp'])
  expect(conversation.runtimeId).toBe('new')
  // What the session's timeline shows, with the labels as they were at the move.
  expect(conversation.timelineEvents).toMatchObject([
    { kind: 'runtime_moved', actorId: 'owner', fromLabel: 'Old runtime', toLabel: 'New runtime' },
  ])
})
test('an active turn preserves the original placement and releases the operation lock', async () => {
  busy = true
  await expect(moveConversationRuntime({ ...conversation }, 'new', 'owner')).rejects.toMatchObject({
    code: 'conversation_busy',
  })
  expect(conversation.runtimeId).toBe('old')
  expect(conversation.runtimeOperation).toBeUndefined()
})
test('only the owner moves the session; a participant, even a former manager, cannot', async () => {
  const shared = { ...conversation, participantIds: ['manager'], managerIds: ['manager'] }

  await expect(moveConversationRuntime(shared, 'new', 'manager')).rejects.toMatchObject({
    status: 403,
  })
  expect(conversation.runtimeId).toBe('old')
})
test('readers and disabled destinations are rejected', async () => {
  await expect(moveConversationRuntime(conversation, 'new', 'reader')).rejects.toMatchObject({
    status: 403,
  })
  target.status = 'disabled'
  await expect(moveConversationRuntime(conversation, 'new', 'owner')).rejects.toMatchObject({
    code: 'runtime_unavailable',
  })
  expect(conversation.runtimeId).toBe('old')
})

test('history moves to the other agent type and leaves no session behind', async () => {
  // The transcript reaches the new inner session as plain text, so the
  // destination's type does not matter. The attachment must go: a session id
  // minted here is not in the destination runtime's namespace, and the first
  // prompt is what creates the real one.
  target.provider = 'codex'
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')

  expect(conversation.agentRuntime).toBe('codex')
  expect(conversation.runtimeId).toBe('new')
  expect(conversation.claudeCodePreview).toBeUndefined()
  // Picks were the old agent's; the destination's list starts fresh.
  expect(conversation.initialSessionConfig).toEqual({})
})

test('a move retains the old runtime without needing an online source', async () => {
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.previousRuntimeUrls).toEqual(['wss://old/acp'])
  expect(conversation.runtimeId).toBe('new')
})

test('a conversation on a retired Nuphos-hosted runtime moves to another agent', async () => {
  const sourceUrl = 'ws://openab-claude-old.openab-runtimes.svc:8080/acp'

  conversation.claudeCodePreview!.runtimeUrl = sourceUrl
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.runtimeId).toBe('new')
  expect(conversation.previousRuntimeUrls).toEqual([sourceUrl])
  expect(conversation.runtimeOperation).toBeUndefined()
})

test('a manually registered in-cluster source remains movable using history', async () => {
  conversation.claudeCodePreview!.runtimeUrl = 'ws://custom.other-ns.svc:1234/acp'
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.runtimeId).toBe('new')
})

useModels({
  teamRuntimeFallbacks: () => ({
    find: () => ({ toArray: async () => [{ runtimeId: 'old', fallbackRuntimeId: 'new' }] }),
  }),
})
useConversationChatRoute({ resolveConversationChatRuntime: async () => ({}) })
const runtimeCatalogOverride = useRuntimeCatalog({
  requireRuntimeInstance: async () => target,
  developmentRuntimeEndpoint: () => {},
})

for (const automatic of [false, true]) {
  test(`explicit pick survives ${automatic ? 'automatic quota fallback' : 'manual same-provider move'}`, async () => {
    conversation.teamId = '000000000000000000000001'
    conversation.claudeCodePreview!.runtimeDefaults = { model: 'old-model', effort: 'low' }
    conversation.claudeCodePreview!.sessionConfig = [
      { id: 'model', kind: 'model', name: 'Model', currentValue: 'chosen-model', options: [] },
      { id: 'effort', kind: 'effort', name: 'Effort', currentValue: 'high', options: [] },
    ]
    if (automatic) {
      runtimeCatalogOverride({
        requireRuntimeInstance: async () => target,
        developmentRuntimeEndpoint: () => {},
        listRuntimeInstances: async () => [{ ...target, id: 'old' }, target],
        listRuntimeQuotas: async () => [
          { runtimeId: 'old', available: true, windows: [{ usedPercent: 95, resetsAt: null }] },
        ],
      })
      await fallBackBeforeTurn({ ...conversation }, 'owner')
    } else await moveConversationRuntime({ ...conversation }, 'new', 'owner')
    expect(conversation.runtimeId).toBe('new')
    expect(conversation.claudeCodePreview).toBeUndefined()
    expect(conversation.initialSessionConfig).toEqual({ model: 'chosen-model', effort: 'high' })
  })
}

test('an unstarted same-provider conversation keeps its explicit initial choices', async () => {
  delete conversation.claudeCodePreview
  conversation.initialSessionConfig = { model: 'chosen-model', effort: 'high' }
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.initialSessionConfig).toEqual({ model: 'chosen-model', effort: 'high' })
})
test('a same-provider move without a pick does not invent one', async () => {
  delete conversation.claudeCodePreview
  delete conversation.initialSessionConfig
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation).toMatchObject({ initialSessionConfig: {} })
})
test('a cross-provider move drops the old choices and stores the effort the destination runs', async () => {
  conversation.claudeCodePreview!.sessionConfig = [
    { id: 'model', kind: 'model', name: 'Model', currentValue: 'chosen-model', options: [] },
    { id: 'effort', kind: 'effort', name: 'Effort', currentValue: 'high', options: [] },
  ]
  destinationDefaults = { modelId: 'latest-model', defaultEffort: 'low' }
  target.provider = 'codex'
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  // Never "nothing": a Task with no stored effort runs on one nobody sees. The
  // model is left to the destination's default, which the picker names.
  expect(conversation.initialSessionConfig).toEqual({ effort: 'low' })
  expect(conversation.claudeCodePreview).toBeUndefined()
})
test('a cross-provider move with an unreadable destination catalog stores no stale choices', async () => {
  destinationModels = null
  target.provider = 'codex'
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.initialSessionConfig).toBeUndefined()
})
test('a same-provider move keeps the model and stores the effort it will run on', async () => {
  delete conversation.claudeCodePreview
  conversation.initialSessionConfig = { model: 'chosen-model' }
  destinationDefaults = { modelId: 'chosen-model', defaultEffort: 'low' }
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.initialSessionConfig).toEqual({ model: 'chosen-model', effort: 'low' })
})

test('a choice saved after the move request was read is preserved from durable state', async () => {
  const requested = { ...conversation, claudeCodePreview: { ...conversation.claudeCodePreview! } }

  conversation.claudeCodePreview = {
    ...conversation.claudeCodePreview!,
    sessionConfig: [
      { id: 'model', kind: 'model', name: 'Model', currentValue: 'latest-model', options: [] },
      { id: 'effort', kind: 'effort', name: 'Effort', currentValue: 'high', options: [] },
    ],
  }
  await moveConversationRuntime(requested, 'new', 'owner')
  expect(conversation.initialSessionConfig).toEqual({ model: 'latest-model', effort: 'high' })
})

test('a model the destination does not offer is left behind; what it offers moves', async () => {
  delete conversation.claudeCodePreview
  conversation.initialSessionConfig = { model: 'chosen-model', effort: 'high' }
  destinationModels = ['latest-model']
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.initialSessionConfig).toEqual({ effort: 'high' })
})
test('an unreadable destination catalog keeps the pick as it was', async () => {
  delete conversation.claudeCodePreview
  conversation.initialSessionConfig = { model: 'chosen-model', effort: 'high' }
  destinationModels = null
  await moveConversationRuntime({ ...conversation }, 'new', 'owner')
  expect(conversation.initialSessionConfig).toEqual({ model: 'chosen-model', effort: 'high' })
})
