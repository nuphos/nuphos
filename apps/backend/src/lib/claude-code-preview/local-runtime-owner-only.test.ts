import { beforeEach, describe, expect, test } from 'bun:test'

import { localRuntimeId, parseLocalRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useDb } from '@/lib/test/doubles/db'
import { useLocalRuntimePresence } from '@/lib/test/doubles/local-runtime-presence'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { resolveConversationChatRuntime } from './conversation-chat-route'
import { moveConversationRuntime } from './conversation-runtime-move'
import { setLocalAgentDefaults } from './local-agent-defaults'
import { listRuntimeInstances, requireRuntimeInstance } from './runtime-catalog'
import { runtimeModelCatalog } from './runtime-models'

import type { AgentConversation } from '@/lib/agent/db/shared'

const TEAM = 'team'
const localId = localRuntimeId({ userId: 'owner', deviceId: 'mac-1', provider: 'claude-code' })
let memory = portabilityDb()
let presence = createMemoryPresenceStore()

useDb({ db: () => memory })
useLocalRuntimePresence({ runtimePresenceStore: () => presence })
useRuntimeRegistry({
  listTeamRuntimes: async () => [],
  resolveTeamRuntimeEndpoints: async () => [],
})
useAgentDeviceStore({
  listAgentDevicesForUser: async (userId) =>
    userId === 'owner'
      ? [
          {
            userId,
            deviceId: 'mac-1',
            label: 'MacBook',
            platform: 'darwin',
            allowLocalExec: false,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ]
      : [],
  isActiveTeamMember: async (_userId, teamId) => teamId === TEAM,
})

function conversation(userId: string): AgentConversation {
  return {
    sessionId: `conversation-${userId}`,
    userId,
    teamId: TEAM,
    title: 'Chat',
    firstMessage: 'Hi',
    messageCount: 2,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    agentRuntime: 'claude-code',
    runtimeId: localId,
  }
}

const notFound = { status: 404, code: 'runtime_not_found' }

beforeEach(async () => {
  memory = portabilityDb()
  presence = createMemoryPresenceStore()
  await presence.claim('owner', 'mac-1', 'c1')
  await presence.put('owner', 'mac-1', {
    conn: 'c1',
    seenAt: Date.now(),
    status: {
      agents: {
        'claude-code': {
          cli: { installed: true, loggedIn: true },
          models: {
            models: [{ id: 'opus', name: 'Opus' }],
            defaultModel: 'opus',
            controls: { opus: { effort: [], fast: false } },
          },
        },
      },
    },
  })
})

describe('a local agent is listed only for its owner', () => {
  test('the owner sees it; a teammate and team-wide lists do not', async () => {
    expect((await listRuntimeInstances(TEAM, 'owner')).map((r) => r.id)).toEqual([localId])
    expect(await listRuntimeInstances(TEAM, 'teammate')).toEqual([])
    expect(await listRuntimeInstances(TEAM)).toEqual([])
  })

  test('a teammate, or a team-scoped call such as runtime defaults, cannot address it', async () => {
    expect(await requireRuntimeInstance(TEAM, localId, 'owner')).toMatchObject({ kind: 'local' })
    await expect(requireRuntimeInstance(TEAM, localId, 'teammate')).rejects.toMatchObject(notFound)
    await expect(requireRuntimeInstance(TEAM, localId)).rejects.toMatchObject(notFound)
  })
})

describe('only the owner can put a session on their local agent', () => {
  test('the owner’s own turn resolves to their computer', async () => {
    const { endpoint } = await resolveConversationChatRuntime(TEAM, conversation('owner'), {
      userId: 'owner',
    })

    expect(parseLocalRuntimeUrl(endpoint.url)).toMatchObject({ userId: 'owner', teamId: TEAM })
  })

  test('control calls on the owner’s conversation act as its owner', async () => {
    const { endpoint } = await resolveConversationChatRuntime(TEAM, conversation('owner'), {
      purpose: 'control',
    })

    expect(endpoint.authKey).toBe('control')
  })

  test('a teammate cannot start a new conversation on it', async () => {
    await expect(
      resolveConversationChatRuntime(TEAM, null, { userId: 'teammate', runtimeId: localId }),
    ).rejects.toMatchObject(notFound)
  })

  test('a teammate continues the owner’s conversation on the owner’s computer', async () => {
    const { endpoint } = await resolveConversationChatRuntime(TEAM, conversation('owner'), {
      userId: 'teammate',
    })

    expect(parseLocalRuntimeUrl(endpoint.url)).toMatchObject({ userId: 'owner', teamId: TEAM })
  })

  test('a teammate cannot put the owner’s unpinned conversation on it', async () => {
    await expect(
      resolveConversationChatRuntime(
        TEAM,
        { ...conversation('owner'), agentRuntime: undefined, runtimeId: undefined },
        { userId: 'teammate', runtimeId: localId },
      ),
    ).rejects.toMatchObject(notFound)
  })

  test('the owner’s computer never serves someone else’s conversation', async () => {
    await expect(
      resolveConversationChatRuntime(TEAM, conversation('teammate'), { userId: 'owner' }),
    ).rejects.toMatchObject(notFound)
    await expect(
      resolveConversationChatRuntime(TEAM, conversation('teammate'), { purpose: 'control' }),
    ).rejects.toMatchObject(notFound)
  })

  test('a teammate cannot move their conversation onto it', async () => {
    const own = { ...conversation('teammate'), runtimeId: 'managed-1' }

    memory.rows('agent_conversations').push(own)
    await expect(
      moveConversationRuntime(own, localId, 'history', 'teammate'),
    ).rejects.toMatchObject(notFound)
    expect(own.runtimeId).toBe('managed-1')
  })
})

describe('an owner’s choices for their local agent', () => {
  test('the owner loads its models; a teammate gets 404', async () => {
    expect(await runtimeModelCatalog(TEAM, localId, undefined, 'owner')).toMatchObject({
      models: [{ id: 'opus' }],
    })
    await expect(runtimeModelCatalog(TEAM, localId, undefined, 'teammate')).rejects.toMatchObject(
      notFound,
    )
  })

  test('its model choice is the owner’s own and never a team runtime default', async () => {
    await setLocalAgentDefaults(localId, { model: 'opus' })

    expect(memory.rows('agent_runtime_defaults')).toEqual([])
    expect((await requireRuntimeInstance(TEAM, localId, 'owner')).defaults).toEqual({
      model: 'opus',
    })
  })
})
