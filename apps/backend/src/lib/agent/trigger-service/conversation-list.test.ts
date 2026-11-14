import { expect, test } from 'bun:test'

import { triggerListFilter } from './list-filter'

test('conversation filtering happens inside the team-scoped database query', () => {
  expect(triggerListFilter({ userId: 'viewer', teamId: 'team' }, 'conversation')).toMatchObject({
    teamId: 'team',
    targetSessionId: 'conversation',
  })
})

test('personal listings stay owner-scoped when filtering by conversation', () => {
  expect(triggerListFilter({ userId: 'viewer' }, 'conversation')).toMatchObject({
    userId: 'viewer',
    teamId: { $exists: false },
    targetSessionId: 'conversation',
  })
})

test('a team listing without a conversation returns only the caller’s own Triggers', () => {
  const filter = triggerListFilter({ userId: 'viewer', teamId: 'team' })

  expect(filter).toMatchObject({ teamId: 'team', userId: 'viewer' })
  expect(filter).not.toHaveProperty('targetSessionId')
})
