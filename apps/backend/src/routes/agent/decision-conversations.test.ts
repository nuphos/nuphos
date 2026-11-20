import { expect, test } from 'bun:test'

import { withDecisionConversations } from './decision-conversations'

import type { AgentConversation } from '@/lib/agent/db'

const source = {
  sessionId: 'coordinator',
  userId: 'owner',
  teamId: 'team',
  linkedResources: [{ id: 'resource' }],
} as AgentConversation
const target = (sessionId: string, fields: Partial<AgentConversation> = {}) =>
  ({
    sessionId,
    title: `Title ${sessionId}`,
    userId: 'owner',
    teamId: 'team',
    ...fields,
  }) as AgentConversation
const row = {
  inputRequests: [{ id: 'question', about: ['worker', 'resource', 'worker', 'second'] }],
}

test('a question names its readable conversation recipients, never its linked resource', async () => {
  const reads: unknown[][] = []
  const result = await withDecisionConversations(row, source, 'viewer', async (...args) => {
    reads.push(args)

    return target(args[0])
  })

  expect(result.inputRequests[0]).toMatchObject({
    aboutConversations: [
      { sessionId: 'worker', title: 'Title worker' },
      { sessionId: 'second', title: 'Title second' },
    ],
  })
  expect(reads).toEqual([
    ['worker', 'viewer', 'team'],
    ['second', 'viewer', 'team'],
  ])
  expect(row.inputRequests[0]).not.toHaveProperty('aboutConversations')
})

test('unreadable, deleted, cross-owner, cross-team and channel targets reveal no title or id', async () => {
  const refs = ['private', 'deleted', 'stranger', 'elsewhere', 'channel', 'coordinator']
  const result = await withDecisionConversations(
    { inputRequests: [{ about: refs }] },
    source,
    'viewer',
    async (ref) => {
      if (ref === 'private' || ref === 'deleted') return null
      if (ref === 'stranger') return target(ref, { userId: 'another' })
      if (ref === 'elsewhere') return target(ref, { teamId: 'another' })

      return target(ref, { kind: 'channel' })
    },
  )

  expect(result.inputRequests[0]).toMatchObject({ aboutConversations: [] })
})

test('resource-only references never read another conversation', async () => {
  const result = await withDecisionConversations(
    { inputRequests: [{ about: ['resource'] }] },
    source,
    'viewer',
    async () => {
      throw new Error('a resource must not be read as a conversation')
    },
  )

  expect(result.inputRequests[0]).toMatchObject({ aboutConversations: [] })
})

test('cards without about need no lookup or extra field', async () => {
  const plain = { inputRequests: [{ id: 'ordinary' }] }

  expect(await withDecisionConversations(plain, source, 'viewer')).toBe(plain)
})
