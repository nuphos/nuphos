import { describe, expect, test } from 'bun:test'

import { tokenStillFresh } from './token-freshness'

describe('tokenStillFresh', () => {
  const inAnHour = () => new Date(Date.now() + 3600 * 1000)
  const aMinuteAgo = () => new Date(Date.now() - 60 * 1000)

  test('a token well ahead of expiry is fresh either way', () => {
    expect(tokenStillFresh(inAnHour(), true)).toBe(true)
    expect(tokenStillFresh(inAnHour(), false)).toBe(true)
  })

  test('an expired token is stale either way', () => {
    expect(tokenStillFresh(aMinuteAgo(), true)).toBe(false)
    expect(tokenStillFresh(aMinuteAgo(), false)).toBe(false)
  })

  test('a token inside the 60s refresh-ahead window is stale, so it cannot expire in flight', () => {
    expect(tokenStillFresh(new Date(Date.now() + 30 * 1000), true)).toBe(false)
  })

  // The regression: every connector used to return true here, pinning a
  // refreshable token in cache forever and never attempting a refresh.
  test('unknown expiry is stale when refreshable, so it cannot be pinned forever', () => {
    expect(tokenStillFresh(null, true)).toBe(false)
  })

  test('unknown expiry is fresh for a legacy binding with nothing to refresh with', () => {
    expect(tokenStillFresh(null, false)).toBe(true)
  })
})
