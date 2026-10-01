import { describe, expect, test } from 'bun:test'

import { parseTriggerIdsParam } from './conversations-trigger-param'

// `triggerId` decides which side of the Chats/Runs split the listing lands on,
// so a malformed value must be a 400 rather than a silent fallback: dropping it
// would hand the Trigger's Runs list the team's entire chat history.

describe('parseTriggerIdsParam', () => {
  test('an absent parameter leaves the listing unfiltered', () => {
    expect(parseTriggerIdsParam(undefined)).toBeUndefined()
  })

  test('a single id becomes a one-element filter', () => {
    expect(parseTriggerIdsParam('6512f0a1b2c3d4e5f6a7b8c9')).toEqual(['6512f0a1b2c3d4e5f6a7b8c9'])
  })

  test('a Watch group passes every partition trigger at once', () => {
    expect(parseTriggerIdsParam('6512f0a1b2c3d4e5f6a7b8c9,6512f0a1b2c3d4e5f6a7b8ca')).toEqual([
      '6512f0a1b2c3d4e5f6a7b8c9',
      '6512f0a1b2c3d4e5f6a7b8ca',
    ])
  })

  test('surrounding whitespace and empty segments are tolerated', () => {
    expect(parseTriggerIdsParam(' 6512f0a1b2c3d4e5f6a7b8c9 , ')).toEqual([
      '6512f0a1b2c3d4e5f6a7b8c9',
    ])
  })

  test('an empty parameter matches nothing rather than becoming Chats', () => {
    expect(parseTriggerIdsParam('')).toEqual([])
    expect(parseTriggerIdsParam('   ')).toEqual([])
  })

  test('a malformed id is rejected instead of quietly dropped', () => {
    expect(() => parseTriggerIdsParam('not-an-object-id')).toThrow()
  })

  test('one malformed id rejects the whole list', () => {
    expect(() => parseTriggerIdsParam('6512f0a1b2c3d4e5f6a7b8c9,nope')).toThrow()
  })

  test('an over-long list is rejected rather than building an unbounded $in', () => {
    const ids = Array.from({ length: 101 }, () => '6512f0a1b2c3d4e5f6a7b8c9').join(',')

    expect(() => parseTriggerIdsParam(ids)).toThrow()
  })
})
