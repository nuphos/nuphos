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

test('a teammate can view and reply to a session on another member’s local agent', async () => {
  const viewer = { id: 'teammate' } as NuphosUser
  const local = { userId: 'owner', teamId, runtimeId: 'local_owner_device' }

  expect(serializeConversationForViewer(local, viewer, new Map())).toMatchObject({
    readOnly: false,
    isOwner: false,
  })
  conversation!.runtimeId = 'local_owner_device'
  expect(await assertConversationSendable('shared', 'teammate', teamId)).toBe(conversation)
})

test('general access and a participant role decide who may reply', async () => {
  conversation!.generalAccess = 'none'
  await expect(assertConversationSendable('shared', 'teammate', teamId)).rejects.toMatchObject({
    status: 403,
  })
  conversation!.participantIds = ['teammate']
  expect(await assertConversationSendable('shared', 'teammate', teamId)).toBe(conversation)
  conversation!.viewOnlyIds = ['teammate']
  await expect(assertConversationSendable('shared', 'teammate', teamId)).rejects.toMatchObject({
    status: 403,
    code: 'conversation_read_only',
  })
  // The broader grant wins: a team that may reply outranks a view-only invite.
  conversation!.generalAccess = 'reply'
  expect(await assertConversationSendable('shared', 'teammate', teamId)).toBe(conversation)
  expect(await assertConversationSendable('shared', 'owner', teamId)).toBe(conversation)
})

test('a viewer who may only read is served read-only', () => {
  const viewer = { id: 'teammate' } as NuphosUser
  const viewOnly = { userId: 'owner', teamId, generalAccess: 'view' }

  expect(serializeConversationForViewer(viewOnly, viewer, new Map())).toMatchObject({
    access: 'view',
    generalAccess: 'view',
    readOnly: true,
  })
})
