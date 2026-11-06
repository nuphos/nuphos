import { describe, expect, test } from 'bun:test'

import { idleConversationFilter } from './conversation-auto-archive'

describe('idleConversationFilter', () => {
  const now = new Date('2026-09-11T12:00:00.000Z')

  test('targets unarchived Tasks, and Bots nobody wrote to, idle past the cutoff, honouring a manual restore', () => {
    const cutoff = new Date('2026-09-04T12:00:00.000Z')

    expect(idleConversationFilter(now, 7)).toEqual({
      archivedAt: { $exists: false },
      lastActiveAt: { $lt: cutoff },
      $and: [
        { $or: [{ avatar: { $exists: false } }, { messageCount: 0 }] },
        {
          $or: [{ archiveRestoredAt: { $exists: false } }, { archiveRestoredAt: { $lt: cutoff } }],
        },
      ],
    })
  })
})
