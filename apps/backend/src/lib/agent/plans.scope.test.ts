import { describe, expect, test } from 'bun:test'

import { scopedNumberFilter } from './plans/scope'

describe('Plan scope', () => {
  test('compounds team ownership with an optional conversation boundary', () => {
    expect(
      scopedNumberFilter(12, {
        teamId: 'team-1',
        userId: 'user-1',
        sourceConversationId: 'conv-1',
      }),
    ).toEqual({ number: 12, teamId: 'team-1', sourceConversationId: 'conv-1' })
  })

  test('preserves ordinary team and personal scopes without a conversation boundary', () => {
    expect(scopedNumberFilter(12, { teamId: 'team-1', userId: 'user-1' })).toEqual({
      number: 12,
      teamId: 'team-1',
    })
    expect(scopedNumberFilter(12, { userId: 'user-1' })).toEqual({
      number: 12,
      createdBy: 'user-1',
    })
  })
})
