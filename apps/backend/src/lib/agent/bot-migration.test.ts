import { describe, expect, test } from 'bun:test'

import { botMigrationFilter, derivedAvatar, lowerMedian } from './bot-migration'

describe('derivedAvatar', () => {
  test('matches the face Desktop derives from the same id', () => {
    // Vectors computed with apps/desktop/src/lib/botAvatars.ts derivedBotAvatar.
    expect(derivedAvatar('00000000-0000-4000-8000-000000000000')).toBe('10-van-gogh')
    expect(derivedAvatar('b2f1c9d4-3a5e-4c7b-9f10-2d3e4f5a6b7c')).toBe('09-frida')
  })
})

describe('botMigrationFilter', () => {
  test('promotes unarchived top-level agents, never threads, trigger runs, chats or Bots', () => {
    expect(botMigrationFilter).toEqual({
      kind: { $ne: 'channel' },
      archivedAt: { $exists: false },
      parentSessionId: { $exists: false },
      'metadata.trigger': { $exists: false },
      avatar: { $exists: false },
    })
  })
})

test('lowerMedian', () => {
  expect(lowerMedian([])).toBe(0)
  expect(lowerMedian([1, 1, 4])).toBe(1)
  expect(lowerMedian([1, 2, 3, 9])).toBe(2)
})
