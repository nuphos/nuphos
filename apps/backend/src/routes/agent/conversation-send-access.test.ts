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

test('a current participant can send without gaining owner management rights', async () => {
  conversation!.participantIds = ['teammate']
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

test('general access lets the team read; only participants reply', async () => {
  await expect(assertConversationSendable('shared', 'teammate', teamId)).rejects.toMatchObject({
    status: 403,
    code: 'conversation_read_only',
  })
  conversation!.generalAccess = 'none'
  await expect(assertConversationSendable('shared', 'teammate', teamId)).rejects.toMatchObject({
    status: 403,
  })
  // On a team runtime every member may use the computer, so a participant replies.
  conversation!.participantIds = ['teammate']
  expect(await assertConversationSendable('shared', 'teammate', teamId)).toBe(conversation)
  expect(await assertConversationSendable('shared', 'owner', teamId)).toBe(conversation)
})

test('a viewer who may only read is served read-only', () => {
  const viewer = { id: 'teammate' } as NuphosUser
  const viewOnly = { userId: 'owner', teamId, generalAccess: 'view' }

  expect(serializeConversationForViewer(viewOnly, viewer, new Map(), null, 'view')).toMatchObject({
    access: 'view',
    generalAccess: 'view',
    readOnly: true,
  })
})

test('the serializer tells each viewer what they may do', () => {
  const doc = { userId: 'owner', teamId, generalAccess: 'none', participantIds: ['invited'] }
  const as = (id: string, access: 'owner' | 'reply' | 'view' | null) =>
    serializeConversationForViewer(doc, { id } as NuphosUser, new Map(), null, access)

  expect(as('owner', 'owner')).toMatchObject({
    access: 'owner',
    readOnly: false,
    isOwner: true,
    canManage: true,
  })
  expect(as('invited', 'reply')).toMatchObject({
    access: 'reply',
    readOnly: false,
    isOwner: false,
    canManage: false,
  })
  // iOS v0.8.0 hides steering, approvals and Stop unless both of these are true.
  expect(as('invited', 'reply')).toMatchObject({ canCancelRun: true, canRespondToRun: true })
  // A participant who may not use the computer reads only.
  expect(as('invited', 'view')).toMatchObject({ readOnly: true, canCancelRun: false })
  expect(as('stranger', null)).toMatchObject({ access: null, readOnly: true })
  expect(
    serializeConversationForViewer(
      { userId: 'owner', teamId },
      { id: 'x' } as NuphosUser,
      new Map(),
      null,
      'view',
    ),
  ).toMatchObject({ generalAccess: 'view' })
})

test('a removed participant falls back to whatever general access still grants', async () => {
  conversation!.generalAccess = 'view'
  conversation!.participantIds = []
  await expect(assertConversationSendable('shared', 'teammate', teamId)).rejects.toMatchObject({
    status: 403,
    code: 'conversation_read_only',
  })
})
