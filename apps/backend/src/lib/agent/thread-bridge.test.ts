import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useThreadQueue } from '@/lib/test/doubles/thread-queue'

import { authorizeThreadDelivery, createAgentThread, sendAgentThreadMessage } from './thread-bridge'

import type { AgentConversation, AgentCredentialAccess } from './db'
import type { ThreadTurn } from './thread-bridge'

const access = {
  awsRoleIds: ['role-1'],
  updatedAt: new Date(),
  updatedBy: 'owner',
} as AgentCredentialAccess
const actor = { userId: 'owner', teamId: 'team', sessionId: 'source', locale: 'zh-TW' }
let source: AgentConversation
let target: AgentConversation
let member = true
let queueFailure = false
const jobs: ThreadTurn[] = []
const shells: Parameters<typeof import('./db').upsertConversationShell>[0][] = []
const deleted: unknown[] = []

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
  queueFailure = false
  jobs.length = 0
  shells.length = 0
  deleted.length = 0
})

useIdentity({ getTeamMembership: async () => (member ? { role: 'MEMBER' } : null) })
useAgentDb({
  getConversationBySessionId: async (id) =>
    id === 'source' ? source : id === 'target' ? target : null,
  upsertConversationShell: async (data) => {
    shells.push(data)

    return { isNew: true }
  },
  agentConversations: () => ({
    deleteOne: async (filter: unknown) => {
      deleted.push(filter)
    },
  }),
})
useThreadQueue({
  enqueueThreadTurn: async (data) => {
    if (queueFailure) throw new Error('queue offline')
    jobs.push(data)
  },
})

describe('conversation-scoped thread tools', () => {
  test('creates a visible conversation with the same principal, runtime and credentials before enqueue', async () => {
    const result = await createAgentThread(actor, 'Wait for CI', 'CI watcher')

    expect(result.status).toBe('queued')
    expect(result.sourceThreadId).toBe('source')
    expect(shells[0]).toMatchObject({
      userId: 'owner',
      teamId: 'team',
      agentRuntime: 'codex',
      runtimeId: 'runtime-1',
      credentialAccess: access,
      sessionId: result.threadId,
    })
    expect(jobs[0]).toMatchObject({
      ...actor,
      targetSessionId: result.threadId,
      prompt: 'Wait for CI',
    })
    expect(shells[0]).not.toHaveProperty('claudeCodePreview')
  })

  test('returns only after the background job was accepted', async () => {
    const result = await sendAgentThreadMessage(actor, 'target', 'CI passed')

    expect(jobs).toHaveLength(1)
    expect(result.messageId).toBe(jobs[0]!.messageId)
  })

  test('queue failure is not reported as success and removes only the new empty shell', async () => {
    queueFailure = true
    await expect(createAgentThread(actor, 'Wait', 'Watcher')).rejects.toThrow('queue offline')
    expect(deleted[0]).toMatchObject({ messageCount: 0, userId: 'owner' })
    await expect(sendAgentThreadMessage(actor, 'target', 'Result')).rejects.toThrow('queue offline')
    expect(jobs).toHaveLength(0)
  })

  test.each([
    ['another owner', { userId: 'teammate' }],
    ['another team', { teamId: 'other-team' }],
    ['archived target', { archivedAt: new Date() }],
  ])('refuses %s', async (_, change) => {
    Object.assign(target, change)
    await expect(sendAgentThreadMessage(actor, 'target', 'Do work')).rejects.toThrow()
    expect(jobs).toHaveLength(0)
  })

  test('delivers to an own thread with another runtime or credential selection', async () => {
    Object.assign(target, {
      runtimeId: 'other-runtime',
      agentRuntime: 'claude-code',
      credentialAccess: { ...access, awsRoleIds: ['role-1', 'role-2'] },
    })
    await sendAgentThreadMessage(actor, 'target', 'Do work')
    expect(jobs).toHaveLength(1)
  })

  test('refuses self-delivery, unknown targets and non-owner source sessions', async () => {
    await expect(sendAgentThreadMessage(actor, 'source', 'Loop')).rejects.toThrow()
    await expect(sendAgentThreadMessage(actor, 'missing', 'Work')).rejects.toThrow()
    source.userId = 'teammate'
    await expect(createAgentThread(actor, 'Work', 'Task')).rejects.toThrow()
  })

  test('rechecks membership and ownership before a queued job executes', async () => {
    await sendAgentThreadMessage(actor, 'target', 'Work')
    member = false
    await expect(authorizeThreadDelivery(jobs[0]!)).rejects.toThrow()
    member = true
    target.userId = 'teammate'
    await expect(authorizeThreadDelivery(jobs[0]!)).rejects.toThrow()
  })
})
