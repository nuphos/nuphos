import { beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useDb } from '@/lib/test/doubles/db'
import { useModels } from '@/lib/test/doubles/models'
import { useRedis } from '@/lib/test/doubles/redis'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { useRuntimeWorkspace } from '@/lib/test/doubles/runtime-workspace'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { moveConversationRuntime } from './conversation-runtime-move'
import { fallBackBeforeTurn } from './runtime-fallback'
import { assertConversationRuntimeAvailable } from './runtime-portability-store'

import type { RuntimeInstance } from './runtime-instances'
import type { ClaudeCodeRuntimeDoc } from './runtime-registry'
import type { AgentConversation } from '@/lib/agent/db/shared'

let memory = portabilityDb()
let busy = false
let restoreFails = false
let target: RuntimeInstance
let conversation: AgentConversation
let restored = false
let saved = false
let archiveAvailable = true
let hostedSources: ClaudeCodeRuntimeDoc[] = []

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
  findHostedRuntime: async (teamId: string, url: string) =>
    hostedSources.find((row) => row.teamId === teamId && row.url === url) ?? null,
  resolveTeamRuntimeEndpoints: async () => [
    { runtimeId: 'new', url: 'wss://new/acp', authKey: 'private' },
  ],
})
useRuntimeWorkspace({
  findWorkspaceArchive: async () => (archiveAvailable ? { createdAt: new Date() } : null),
  saveRuntimeWorkspace: async () => {
    saved = true

    return {}
  },
  restoreRuntimeWorkspace: async () => {
    // A concurrent send must fail while files are being restored.
    await expect(assertConversationRuntimeAvailable('conversation')).rejects.toMatchObject({
      code: 'runtime_moving',
    })
    if (restoreFails) throw new Error('Restore failed')
    restored = true
  },
})
beforeEach(() => {
  memory = portabilityDb()
  busy = false
  restoreFails = false
  restored = false
  saved = false
  archiveAvailable = true
  hostedSources = []
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
test('moves the same conversation after restoring files and keeps history and settings', async () => {
  await moveConversationRuntime({ ...conversation }, 'new', 'workspace', 'owner')
  expect(restored).toBe(true)
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
test('an already removed runtime can continue using history without pretending files were restored', async () => {
  await moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner')
  expect(restored).toBe(false)
  expect(conversation.runtimeMigration?.mode).toBe('history')
  expect(conversation.previousRuntimeUrls).toEqual(['wss://old/acp'])
  expect(conversation.runtimeId).toBe('new')
  // What the session's timeline shows, with the labels as they were at the move.
  expect(conversation.timelineEvents).toMatchObject([
    { kind: 'runtime_moved', actorId: 'owner', fromLabel: 'Old runtime', toLabel: 'New runtime' },
  ])
})
test('failed restore and active turns preserve the original placement and release the operation lock', async () => {
  restoreFails = true
  await expect(
    moveConversationRuntime({ ...conversation }, 'new', 'workspace', 'owner'),
  ).rejects.toThrow('Restore failed')
  expect(conversation.runtimeId).toBe('old')
  expect(conversation.runtimeOperation).toBeUndefined()
  busy = true
  await expect(
    moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner'),
  ).rejects.toMatchObject({ code: 'conversation_busy' })
  expect(conversation.runtimeId).toBe('old')
  expect(conversation.runtimeOperation).toBeUndefined()
})
test('only the owner moves the session; a participant, even a former manager, cannot', async () => {
  const shared = { ...conversation, participantIds: ['manager'], managerIds: ['manager'] }

  await expect(moveConversationRuntime(shared, 'new', 'history', 'manager')).rejects.toMatchObject({
    status: 403,
  })
  expect(conversation.runtimeId).toBe('old')
})
test('readers, disabled destinations, and deleting destinations are rejected', async () => {
  await expect(
    moveConversationRuntime(conversation, 'new', 'history', 'reader'),
  ).rejects.toMatchObject({ status: 403 })
  target.status = 'disabled'
  await expect(
    moveConversationRuntime(conversation, 'new', 'history', 'owner'),
  ).rejects.toMatchObject({ code: 'runtime_unavailable' })
  target.status = 'active'
  memory.rows('agent_runtime_deletions').push({ _id: 'new', teamId: 'team' })
  await expect(
    moveConversationRuntime(conversation, 'new', 'history', 'owner'),
  ).rejects.toMatchObject({ code: 'runtime_deleting' })
  expect(conversation.runtimeId).toBe('old')
})

test('history moves to the other agent type and leaves no session behind', async () => {
  // The transcript reaches the new inner session as plain text, so the
  // destination's type does not matter. The attachment must go: a session id
  // minted here is not in the destination runtime's namespace, and the first
  // prompt is what creates the real one.
  target.provider = 'codex'
  await moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner')

  expect(conversation.agentRuntime).toBe('codex')
  expect(conversation.runtimeId).toBe('new')
  expect(conversation.claudeCodePreview).toBeUndefined()
  // Picks were the old agent's; the destination's list starts fresh.
  expect(conversation.initialSessionConfig).toBeUndefined()
})

test('a workspace cannot move to the other agent type', async () => {
  target.provider = 'codex'
  await expect(
    moveConversationRuntime(conversation, 'new', 'workspace', 'owner'),
  ).rejects.toMatchObject({ code: 'runtime_provider_mismatch' })
  expect(conversation.runtimeId).toBe('old')
  expect(conversation.claudeCodePreview?.openabSessionId).toBe('native-old')
})

test('history-only moves retain old workspace ownership without needing an online source', async () => {
  archiveAvailable = false
  memory.rows('agent_runtime_deletions').push({
    _id: 'old',
    teamId: 'team',
    requestedAt: new Date(),
    placements: [{ url: 'wss://old/acp', state: 'pending' }],
  })
  await moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner')
  expect(saved).toBe(false)
  expect(restored).toBe(false)
  expect(conversation.previousRuntimeUrls).toEqual(['wss://old/acp'])
  expect(conversation.runtimeId).toBe('new')
})

test('neither move mode can overwrite a different environment attachment in the shared database', async () => {
  const namespace = `${config.claudeCodeRuntimeProvisioner.namespace}-other`
  const sourceUrl = `ws://openab-claude-old.${namespace}.svc:8080/acp`

  conversation.claudeCodePreview!.runtimeUrl = sourceUrl
  hostedSources = [
    {
      _id: 'old',
      teamId: 'team',
      url: sourceUrl,
      hostedBy: 'nuphos',
      status: 'active',
      createdByUserId: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]
  for (const mode of ['history', 'workspace'] as const) {
    await expect(
      moveConversationRuntime({ ...conversation }, 'new', mode, 'owner'),
    ).rejects.toMatchObject({
      code: 'runtime_environment_mismatch',
    })
    expect(conversation.runtimeId).toBe('old')
    expect(conversation.claudeCodePreview!.runtimeUrl).toBe(sourceUrl)
    expect(conversation.runtimeOperation).toBeUndefined()
  }
  expect(saved).toBe(false)
  expect(restored).toBe(false)
})

test('a manually registered in-cluster source remains movable using history', async () => {
  conversation.claudeCodePreview!.runtimeUrl = 'ws://custom.other-ns.svc:1234/acp'
  await moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner')
  expect(conversation.runtimeId).toBe('new')
  expect(saved).toBe(false)
  expect(restored).toBe(false)
})

test('a deleted source keeps its last archive available for workspace moves', async () => {
  memory.rows('agent_runtime_deletions').push({
    _id: 'old',
    teamId: 'team',
    requestedAt: new Date(Date.now() + 60_000),
    completedAt: new Date(),
    placements: [{ url: 'wss://old/acp', state: 'deleted' }],
  })
  await moveConversationRuntime({ ...conversation }, 'new', 'workspace', 'owner')
  expect(saved).toBe(false)
  expect(restored).toBe(true)
})

useModels({ userTeamRuntimeFallbacks: () => ({ findOne: async () => ({ runtimeIds: ['new'] }) }) })
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
    } else await moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner')
    expect(conversation.runtimeId).toBe('new')
    expect(conversation.claudeCodePreview).toBeUndefined()
    expect(conversation.initialSessionConfig).toEqual({ model: 'chosen-model', effort: 'high' })
  })
}

test('an unstarted same-provider conversation keeps its explicit initial choices', async () => {
  delete conversation.claudeCodePreview
  conversation.initialSessionConfig = { model: 'chosen-model', effort: 'high' }
  await moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner')
  expect(conversation.initialSessionConfig).toEqual({ model: 'chosen-model', effort: 'high' })
})
test('a same-provider move without a pick does not invent one', async () => {
  delete conversation.claudeCodePreview
  delete conversation.initialSessionConfig
  await moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner')
  expect(conversation).toMatchObject({ initialSessionConfig: {} })
})
test('a cross-provider move clears confirmed choices as well as the old attachment', async () => {
  conversation.claudeCodePreview!.sessionConfig = [
    { id: 'model', kind: 'model', name: 'Model', currentValue: 'chosen-model', options: [] },
  ]
  target.provider = 'codex'
  await moveConversationRuntime({ ...conversation }, 'new', 'history', 'owner')
  expect(conversation.initialSessionConfig).toBeUndefined()
  expect(conversation.claudeCodePreview).toBeUndefined()
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
  await moveConversationRuntime(requested, 'new', 'history', 'owner')
  expect(conversation.initialSessionConfig).toEqual({ model: 'latest-model', effort: 'high' })
})
