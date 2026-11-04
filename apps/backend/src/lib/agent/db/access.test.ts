import { describe, expect, test } from 'bun:test'

import {
  canReply,
  conversationAccess,
  generalAccessOf,
  initialGeneralAccess,
  readableByFilter,
  readableConversationScope,
  readsConversation,
} from './access'

const base = { userId: 'owner', teamId: 'team' }

describe('conversationAccess', () => {
  test('the owner always has full access, even in a private session', () => {
    expect(conversationAccess({ ...base, generalAccess: 'none' }, 'owner', false)).toBe('owner')
  })

  test('older sessions without general access stay open to the team to read', () => {
    expect(conversationAccess(base, 'teammate', true)).toBe('view')
    expect(conversationAccess({ ...base, generalAccess: 'reply' }, 'teammate', true)).toBe('view')
  })

  test('a private session is closed to everyone not invited', () => {
    expect(conversationAccess({ ...base, generalAccess: 'none' }, 'teammate', true)).toBeNull()
  })

  test('a participant replies only while they may use the computer', () => {
    const invited = { ...base, generalAccess: 'none' as const, participantIds: ['teammate'] }

    expect(conversationAccess(invited, 'teammate', true)).toBe('reply')
    expect(conversationAccess(invited, 'teammate', false)).toBe('view')
  })

  test('older view-only and manager marks change nothing', () => {
    const legacy = {
      ...base,
      generalAccess: 'none' as const,
      participantIds: ['viewer', 'manager'],
      viewOnlyIds: ['viewer'],
      managerIds: ['manager'],
    }

    expect(conversationAccess(legacy, 'viewer', true)).toBe('reply')
    expect(conversationAccess(legacy, 'manager', false)).toBe('view')
  })

  test('a personal conversation is the owner’s alone', () => {
    expect(conversationAccess({ userId: 'owner' }, 'teammate', true)).toBeNull()
  })
})

test('new sessions begin private unless a channel or trigger created them', () => {
  expect(initialGeneralAccess('app')).toBe('none')
  expect(initialGeneralAccess('mcp')).toBe('none')
  expect(initialGeneralAccess('agent.thread')).toBe('none')
  // A transcript sync can insert before /chat and carries no source.
  expect(initialGeneralAccess(undefined)).toBe('none')
  expect(initialGeneralAccess('slack.agent')).toBeUndefined()
  expect(initialGeneralAccess('discord.agent')).toBeUndefined()
  expect(initialGeneralAccess('lark.agent')).toBeUndefined()
  expect(initialGeneralAccess('agent.trigger')).toBeUndefined()
})

describe('edge cases', () => {
  test('only owner and reply may reply', () => {
    expect(canReply('owner')).toBe(true)
    expect(canReply('reply')).toBe(true)
    expect(canReply('view')).toBe(false)
    expect(canReply(null)).toBe(false)
  })

  test('general access is none or view', () => {
    expect(generalAccessOf({})).toBe('view')
    expect(generalAccessOf({ generalAccess: 'reply' })).toBe('view')
    expect(generalAccessOf({ generalAccess: 'none' })).toBe('none')
  })
})

describe('readableConversationScope', () => {
  test('without a team it is the owner alone', () => {
    expect(readableConversationScope({ sessionId: 's' }, 'viewer', undefined)).toEqual({
      sessionId: 's',
      userId: 'viewer',
    })
  })

  test('with a team it adds who may read', () => {
    expect(readableConversationScope({ sessionId: 's' }, 'viewer', 'team')).toEqual({
      sessionId: 's',
      teamId: 'team',
      ...readableByFilter('viewer'),
    })
  })
})

// The Mongo filter and the JS rule are two spellings of one decision. Evaluate
// the filter the way Mongo would over every combination and require that they
// agree, so neither can drift from the other.
function mongoMatches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return (expected as Record<string, unknown>[]).some((clause) => mongoMatches(doc, clause))
    }
    const actual = doc[key]

    if (expected && typeof expected === 'object' && '$ne' in expected) {
      // $ne also matches a missing field, like Mongo.
      return Array.isArray(actual)
        ? !actual.includes(expected.$ne)
        : actual !== (expected as { $ne: unknown }).$ne
    }

    return Array.isArray(actual) ? actual.includes(expected) : actual === expected
  })
}

test('readableByFilter admits exactly the viewers readsConversation admits', () => {
  const generals = [undefined, 'none', 'view', 'reply'] as const
  const memberships = [{}, { participantIds: ['viewer'] }, { participantIds: ['someone-else'] }]
  let checked = 0

  for (const owner of ['owner', 'viewer'])
    for (const generalAccess of generals)
      for (const membership of memberships) {
        const doc = {
          userId: owner,
          teamId: 'team',
          ...(generalAccess ? { generalAccess } : {}),
          ...membership,
        }

        expect(mongoMatches(doc, readableByFilter('viewer'))).toBe(readsConversation(doc, 'viewer'))
        checked++
      }
  expect(checked).toBe(24)
})
