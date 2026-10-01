import { describe, expect, test } from 'bun:test'

import { idleConversationFilter } from './conversation-auto-archive'

describe('idleConversationFilter', () => {
  const now = new Date('2026-09-11T12:00:00.000Z')

  test('targets unarchived conversations idle past the cutoff, honouring a manual restore', () => {
    const cutoff = new Date('2026-09-04T12:00:00.000Z')

    expect(idleConversationFilter(now, 7)).toEqual({
      archivedAt: { $exists: false },
      lastActiveAt: { $lt: cutoff },
      $or: [{ archiveRestoredAt: { $exists: false } }, { archiveRestoredAt: { $lt: cutoff } }],
    })
  })
})
