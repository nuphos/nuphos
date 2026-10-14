import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useConversationRuntimeMove } from '@/lib/test/doubles/conversation-runtime-move'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import { clearPendingUserMessages } from './pending-messages'
import { getSessionBypass, setSessionBypass } from './auto-mode/store'
import {
  authorizeThreadDelivery,
  createAgentThread,
  sendAgentThreadMessage,
  updateThread,
} from './thread-bridge'
import { installTurnRunner, resetTurnRunner } from './turn-runner'

import type { AgentConversation, AgentCredentialAccess } from './db'
import type { TurnRunner } from './turn-runner'

const access = {
  awsRoleIds: ['role-1'],
  updatedAt: new Date(),
  updatedBy: 'owner',
} as AgentCredentialAccess
const actor = { userId: 'owner', teamId: 'team', sessionId: 'source', locale: 'zh-TW' }
let source: AgentConversation
let target: AgentConversation
let member = true
const claims: Parameters<TurnRunner['claimAgentRunOrEnqueue']>[0][] = []
const shells: Parameters<typeof import('./db').upsertConversationShell>[0][] = []

beforeEach(() => {
  source = {
    ...actor,
    title: 'Source',
    firstMessage: 'Original',
    messageCount: 1,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    credentialAccess: access,
    agentRuntime: 'codex',
    runtimeId: 'runtime-1',
  }
  target = { ...source, sessionId: 'target' }
  member = true
  claims.length = 0
  shells.length = 0
  bypass.clear()
  events.length = 0
  moves.length = 0
  credentialWrites.length = 0
  installTurnRunner({
    claimAgentRunOrEnqueue: async (args) => {
      claims.push(args)

      return { mode: 'queued' }
    },
  })
})
afterEach(async () => {
  resetTurnRunner()
  for (const id of ['target', ...shells.map((shell) => shell.sessionId)])
    await clearPendingUserMessages('owner', id)
})

useIdentity({
  getTeamMembership: async () => (member ? { role: 'MEMBER' } : null),
  signNuphosToken: () => 'test-token',
})
const bypass = new Map<string, Record<string, unknown>>()
const events: { conversationId: string; event: string }[] = []
const moves: { sessionId: string; runtimeId: string; mode: string; userId: string }[] = []
const credentialWrites: { sessionId: string; access: AgentCredentialAccess }[] = []
// Online devices of the owner; 'mac-2' is online but not selected for the parent.
const onlineDevices = ['mac-1', 'mac-2']

useDb({
  db: () => ({
    collection: () => ({
      updateOne(
        filter: { conversationId: string; userId: string },
        update: { $setOnInsert?: Record<string, unknown>; $set?: Record<string, unknown> },
        options: { upsert?: boolean },
      ) {
        const key = `${filter.userId}:${filter.conversationId}`
        let doc = bypass.get(key)

        if (!doc && options.upsert) {
          doc = { ...filter, ...update.$setOnInsert }
          bypass.set(key, doc)
        }
        if (doc) Object.assign(doc, update.$set)

        return Promise.resolve()
      },
      findOne(filter: { conversationId: string; userId: string }) {
        return Promise.resolve(bypass.get(`${filter.userId}:${filter.conversationId}`) ?? null)
      },
    }),
  }),
})
useConversationRuntimeMove({
  moveConversationRuntime: async (conversation, runtimeId, mode, userId) => {
    moves.push({ sessionId: conversation.sessionId, runtimeId, mode, userId })

    return { runtimeId, runtimeLabel: 'Other', agentRuntime: 'codex', mode }
  },
})
useCredentialOptions({
  getAgentCredentialOptions: async () =>
    ({
      devices: [
        ...onlineDevices.map((deviceId) => ({ deviceId, label: deviceId, available: true })),
        // Listed, as all of the owner's devices are, but not usable now.
        { deviceId: 'offline-mac', label: 'offline-mac', available: false },
      ].map((device) => ({ ...device, platform: 'darwin' })),
    }) as never,
})
useRuntimeCatalog({
  // Without a user only the team's agents are listed; a local one would need the owner.
  listRuntimeInstances: async (_teamId, userId) => [
    {
      id: 'runtime-2',
      provider: 'codex',
      label: 'Other',
      status: 'active',
      kind: 'managed',
      createdAt: '',
    },
    ...(userId
      ? [
          {
            id: 'local-1',
            provider: 'codex' as const,
            label: 'Mac',
            status: 'active' as const,
            kind: 'local' as const,
            createdAt: '',
          },
        ]
      : []),
  ],
})
useAgentDb({
  getConversationBySessionId: async (id) =>
    id === 'source'
      ? source
      : id === 'target'
        ? target
        : shells.some((shell) => shell.sessionId === id)
          ? {
              ...source,
              sessionId: id,
              parentSessionId: shells.find((shell) => shell.sessionId === id)?.parentSessionId,
              createdBySessionId: shells.find((shell) => shell.sessionId === id)?.parentSessionId,
            }
          : null,
  upsertConversationShell: async (data) => {
    shells.push(data)

    return { isNew: true }
  },
  agentMessages: () => ({ findOne: async () => null }),
  recordAgentEvent: (event) => {
    events.push(event)
  },
  updateConversationCredentialAccess: async (sessionId, _userId, _teamId, credentialAccess) => {
    credentialWrites.push({ sessionId, access: credentialAccess })

    return null
  },
  getConversationWithMessages: async (sessionId) => ({
    conversation: { ...source, sessionId },
    messages: [],
  }),
})

describe('conversation-scoped thread tools', () => {
  test('creates a visible conversation with the same principal, runtime and credentials, then starts it', async () => {
    const result = await createAgentThread(actor, 'Wait for CI', 'CI watcher')

    expect(result.status).toBe('delivered')
    expect(result.sourceThreadId).toBe('source')
    expect(shells[0]).toMatchObject({
      userId: 'owner',
      teamId: 'team',
      agentRuntime: 'codex',
      runtimeId: 'runtime-1',
      credentialAccess: access,
      sessionId: result.threadId,
      parentSessionId: 'source',
    })
    expect(shells[0]).not.toHaveProperty('claudeCodePreview')
    expect(claims[0]).toMatchObject({
      userId: 'owner',
      sessionId: result.threadId,
      message: { id: result.messageId, renderedText: 'Wait for CI' },
    })
    expect(claims[0]?.message.metadata).toMatchObject({
      source: 'agent.thread',
      sourceSessionId: 'source',
    })
  })

  test('returns without waiting for the turn, like a message typed into a chat', async () => {
    const runs: Parameters<TurnRunner['runAgentForTrigger']>[0][] = []

    installTurnRunner({
      claimAgentRunOrEnqueue: async (args) => {
        claims.push(args)

        return { mode: 'run', carried: [], release: () => {} }
      },
      runAgentForTrigger: (args) => {
        runs.push(args)

        // A long turn that never finishes must not hold back other threads.
        return new Promise(() => {})
      },
    })
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createAgentThread(actor, `Task ${i}`, `Thread ${i}`)),
    )

    expect(results.map((result) => result.status)).toEqual(Array(12).fill('started'))
    for (let i = 0; i < 200 && runs.length < 12; i++) await Bun.sleep(5)
    expect(runs).toHaveLength(12)
    expect(new Set(claims.map((claim) => claim.sessionId))).toEqual(
      new Set(results.map((result) => result.threadId)),
    )
  })

  test.each([true, false])("a thread starts in its parent's mode (Full Access %p)", async (on) => {
    await setSessionBypass('source', 'owner', on)
    const result = await createAgentThread(actor, 'Work', 'Task')

    expect(await getSessionBypass(result.threadId, 'owner')).toBe(on)
  })

  test('a Full Access parent switches its thread to Auto Mode and back', async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await updateThread(actor, threadId, { fullAccess: false })
    expect(await getSessionBypass(threadId, 'owner')).toBe(false)
    await updateThread(actor, threadId, { fullAccess: true })
    expect(await getSessionBypass(threadId, 'owner')).toBe(true)
    expect(events.map((e) => [e.conversationId, e.event])).toEqual([
      [threadId, 'auth.bypass_disabled'],
      [threadId, 'auth.bypass_enabled'],
    ])
  })

  test('an Auto Mode parent cannot give its thread Full Access, but can still lower it', async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await setSessionBypass('source', 'owner', false)
    await expect(updateThread(actor, threadId, { fullAccess: true })).rejects.toThrow('Full Access')
    expect(await getSessionBypass(threadId, 'owner')).toBe(true)
    await updateThread(actor, threadId, { fullAccess: false })
    expect(await getSessionBypass(threadId, 'owner')).toBe(false)
  })

  test('only a thread this conversation created can be switched', async () => {
    await setSessionBypass('source', 'owner', true)
    await expect(updateThread(actor, 'target', { fullAccess: true })).rejects.toThrow('created')
    await expect(updateThread(actor, 'source', { fullAccess: true })).rejects.toThrow()
    expect(await getSessionBypass('target', 'owner')).toBe(false)
    expect(events).toHaveLength(0)
  })

  test("a conversation adopted as a child is not the caller's to change", async () => {
    await setSessionBypass('source', 'owner', true)
    target = { ...target, parentSessionId: 'source' }
    await expect(updateThread(actor, 'target', { fullAccess: true })).rejects.toThrow('created')
    await expect(updateThread(actor, 'target', { runtimeId: 'runtime-2' })).rejects.toThrow(
      'created',
    )
    expect(await getSessionBypass('target', 'owner')).toBe(false)
    expect(moves).toHaveLength(0)
  })

  test("a thread starts with exactly its parent's devices", async () => {
    source = { ...source, credentialAccess: { ...access, deviceIds: ['mac-1', 'offline-mac'] } }
    await createAgentThread(actor, 'Work', 'Task')

    expect(shells[0]?.credentialAccess?.deviceIds).toEqual(['mac-1', 'offline-mac'])
  })

  test('a parent sets its thread to the devices it can use itself, and nothing else', async () => {
    source = { ...source, credentialAccess: { ...access, deviceIds: ['mac-1', 'offline-mac'] } }
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')
    const result = await updateThread(actor, threadId, { deviceIds: ['mac-1'] })

    expect(result.deviceIds).toEqual(['mac-1'])
    expect(credentialWrites).toEqual([
      {
        sessionId: threadId,
        access: expect.objectContaining({ awsRoleIds: ['role-1'], deviceIds: ['mac-1'] }),
      },
    ])
    // Online but not the parent's, the parent's but offline, or unknown: all refused.
    for (const id of ['mac-2', 'offline-mac', 'someone-elses-mac'])
      await expect(updateThread(actor, threadId, { deviceIds: [id] })).rejects.toThrow(id)
    await updateThread(actor, threadId, { deviceIds: [] })
    expect(credentialWrites.map((w) => w.access.deviceIds)).toEqual([['mac-1'], []])
    await expect(updateThread(actor, 'target', { deviceIds: [] })).rejects.toThrow('created')
  })

  test("a thread never moves onto the owner's computer", async () => {
    await setSessionBypass('source', 'owner', true)
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')

    await expect(updateThread(actor, threadId, { runtimeId: 'local-1' })).rejects.toThrow(
      'computer',
    )
    expect(moves).toHaveLength(0)
  })

  test('a parent moves its thread to another agent through the shared move path', async () => {
    const { threadId } = await createAgentThread(actor, 'Work', 'Task')
    const result = await updateThread(actor, threadId, { runtimeId: 'runtime-2' })

    expect(moves).toEqual([
      { sessionId: threadId, runtimeId: 'runtime-2', mode: 'history', userId: 'owner' },
    ])
    expect(result.runtime?.runtimeId).toBe('runtime-2')
    await expect(updateThread(actor, 'target', { runtimeId: 'runtime-2' })).rejects.toThrow(
      'created',
    )
    expect(moves).toHaveLength(1)
  })

  test('send returns the delivered message id', async () => {
    const result = await sendAgentThreadMessage(actor, 'target', 'CI passed')

    expect(claims).toHaveLength(1)
    expect(result.messageId).toBe(claims[0]!.message.id)
  })

  test.each([
    ['another owner', { userId: 'teammate' }],
    ['another team', { teamId: 'other-team' }],
    ['archived target', { archivedAt: new Date() }],
  ])('refuses %s', async (_, change) => {
    Object.assign(target, change)
    await expect(sendAgentThreadMessage(actor, 'target', 'Do work')).rejects.toThrow()
    await Bun.sleep(20)
    expect(claims).toHaveLength(0)
  })

  test('delivers to an own thread with another runtime or credential selection', async () => {
    Object.assign(target, {
      runtimeId: 'other-runtime',
      agentRuntime: 'claude-code',
      credentialAccess: { ...access, awsRoleIds: ['role-1', 'role-2'] },
    })
    await sendAgentThreadMessage(actor, 'target', 'Do work')
    expect(claims).toHaveLength(1)
  })

  test('refuses self-delivery, unknown targets and non-owner source sessions', async () => {
    await expect(sendAgentThreadMessage(actor, 'source', 'Loop')).rejects.toThrow()
    await expect(sendAgentThreadMessage(actor, 'missing', 'Work')).rejects.toThrow()
    source.userId = 'teammate'
    await expect(createAgentThread(actor, 'Work', 'Task')).rejects.toThrow()
  })

  test('rechecks membership and ownership when the turn starts', async () => {
    const data = { ...actor, targetSessionId: 'target', messageId: 'delivery', prompt: 'Work' }

    member = false
    await expect(authorizeThreadDelivery(data)).rejects.toThrow()
    member = true
    target.userId = 'teammate'
    await expect(authorizeThreadDelivery(data)).rejects.toThrow()
  })
})
