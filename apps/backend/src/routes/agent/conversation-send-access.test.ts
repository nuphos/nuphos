import { beforeEach, expect, test } from 'bun:test'

import { serializeConversationForViewer } from './conversation-view'
import { assertConversationSendable, assertConversationWritable } from './team-scope'

import type { AgentConversation } from '@/lib/agent/db'
import type { NuphosUser } from '@/lib/identity'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
let member = true
let conversation: AgentConversation | null

useAgentDb({ getConversationBySessionId: async () => conversation })
useIdentity({ getTeamMembership: async () => (member ? { role: 'MEMBER' } : null) })

beforeEach(() => {
  member = true
  conversation = { sessionId: 'shared', userId: 'owner', teamId } as AgentConversation
})

test('a current teammate can send without gaining owner management rights', async () => {
  expect(await assertConversationSendable('shared', 'teammate', teamId)).toBe(conversation)
  await expect(assertConversationWritable('shared', 'teammate', teamId)).rejects.toMatchObject({
    status: 403,
  })
})

test('revoked membership, another team and unscoped private sessions stay closed', async () => {
  member = false
  await expect(assertConversationSendable('shared', 'teammate', teamId)).rejects.toMatchObject({
    status: 403,
  })
  member = true
  await expect(
    assertConversationSendable('shared', 'teammate', 'other-team'),
  ).rejects.toMatchObject({ status: 409 })
  conversation!.teamId = undefined
  await expect(assertConversationSendable('shared', 'teammate', undefined)).rejects.toMatchObject({
    status: 403,
  })
  expect(await assertConversationSendable('shared', 'owner', undefined)).toBe(conversation)
})

test('shared agents are writable in the UI but another member’s local agent is private', () => {
  const viewer = { id: 'teammate' } as NuphosUser
  const shared = { userId: 'owner', teamId, runtimeId: 'managed-agent' }

  expect(serializeConversationForViewer(shared, viewer, new Map())).toMatchObject({
    readOnly: false,
    isOwner: false,
  })
  expect(
    serializeConversationForViewer(
      { ...shared, runtimeId: 'local_owner_device' },
      viewer,
      new Map(),
    ),
  ).toMatchObject({ readOnly: true })
})

test('sending to another member’s Local Agent is rejected before turn preparation', async () => {
  conversation!.runtimeId = 'local_owner_device'
  await expect(assertConversationSendable('shared', 'teammate', teamId)).rejects.toMatchObject({
    status: 403,
    code: 'local_agent_private',
  })
  expect(await assertConversationSendable('shared', 'owner', teamId)).toBe(conversation)
})
