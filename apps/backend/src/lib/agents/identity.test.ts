import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

let stored: Record<string, unknown> | null
let lastFilter: Record<string, unknown> | undefined

useAgentDb({
  agentConversations: () => ({
    findOne: (filter: Record<string, unknown>) => {
      lastFilter = filter

      return Promise.resolve(stored && filter.userId === stored.userId ? stored : null)
    },
  }),
})

const { verifyAgentForActor } = await import('./identity')

const shared = { userId: 'owner', teamId: 'team-1', sessionId: 's1' }

beforeEach(() => {
  stored = null
  lastFilter = undefined
})

describe('verifyAgentForActor', () => {
  test('lets the owner act on their own conversation', async () => {
    stored = { ...shared, generalAccess: 'none' }

    expect(await verifyAgentForActor('owner', 'owner', 's1')).toEqual({
      userId: 'owner',
      sessionId: 's1',
    })
  })

  test('rejects a conversation the named owner does not own', async () => {
    stored = { ...shared, userId: 'someone-else' }

    expect(await verifyAgentForActor('guest', 'owner', 's1')).toBeNull()
    expect(lastFilter).toEqual({ sessionId: 's1', userId: 'owner' })
  })

  test('lets a teammate who can reply act as themselves', async () => {
    stored = { ...shared, generalAccess: 'none', participantIds: ['guest'] }

    expect(await verifyAgentForActor('guest', 'owner', 's1')).toEqual({
      userId: 'guest',
      sessionId: 's1',
      conversationOwnerUserId: 'owner',
    })
  })

  test('keeps channel conversations open to the team', async () => {
    // Slack, Discord and Lark conversations leave generalAccess unset: team-wide reply.
    stored = { ...shared }

    expect(await verifyAgentForActor('teammate', 'owner', 's1')).not.toBeNull()
  })

  test('stops a teammate once the conversation is unshared', async () => {
    stored = { ...shared, generalAccess: 'none', participantIds: [] }

    expect(await verifyAgentForActor('guest', 'owner', 's1')).toBeNull()
  })

  test('stops a teammate whose grant was lowered to view', async () => {
    stored = {
      ...shared,
      generalAccess: 'view',
      participantIds: ['guest'],
      viewOnlyIds: ['guest'],
    }

    expect(await verifyAgentForActor('guest', 'owner', 's1')).toBeNull()
  })
  test('lets a teammate invited to manage act', async () => {
    stored = { ...shared, generalAccess: 'none', participantIds: ['guest'], managerIds: ['guest'] }

    expect(await verifyAgentForActor('guest', 'owner', 's1')).not.toBeNull()
  })

  test('keeps a conversation without a team owner-only', async () => {
    stored = { userId: 'owner', sessionId: 's1' }

    expect(await verifyAgentForActor('guest', 'owner', 's1')).toBeNull()
  })
})
