import { describe, expect, test } from 'bun:test'

import { conversationAccess, initialGeneralAccess } from './access'

const base = { userId: 'owner', teamId: 'team' }

describe('conversationAccess', () => {
  test('the owner always has full access, even in a private session', () => {
    expect(conversationAccess({ ...base, generalAccess: 'none' }, 'owner')).toBe('owner')
  })

  test('older sessions without general access stay open to the team', () => {
    expect(conversationAccess(base, 'teammate')).toBe('reply')
  })

  test('a private session is closed to everyone not invited', () => {
    expect(conversationAccess({ ...base, generalAccess: 'none' }, 'teammate')).toBeNull()
  })

  test('the broader of general access and the own role wins', () => {
    const viewOnlyInvite = { participantIds: ['teammate'], viewOnlyIds: ['teammate'] }

    expect(
      conversationAccess({ ...base, generalAccess: 'none', ...viewOnlyInvite }, 'teammate'),
    ).toBe('view')
    expect(
      conversationAccess({ ...base, generalAccess: 'reply', ...viewOnlyInvite }, 'teammate'),
    ).toBe('reply')
    expect(
      conversationAccess(
        { ...base, generalAccess: 'view', participantIds: ['teammate'] },
        'teammate',
      ),
    ).toBe('reply')
  })

  test('a personal conversation is the owner’s alone', () => {
    expect(conversationAccess({ userId: 'owner' }, 'teammate')).toBeNull()
  })
})

test('sessions started from the app or an external client begin private', () => {
  expect(initialGeneralAccess('app')).toBe('none')
  expect(initialGeneralAccess('mcp')).toBe('none')
  expect(initialGeneralAccess('slack.agent')).toBeUndefined()
  expect(initialGeneralAccess('agent.trigger')).toBeUndefined()
})
