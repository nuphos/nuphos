import { describe, expect, test } from 'bun:test'

import { coversExactly } from '@/lib/vault'

describe('coversExactly', () => {
  test('accepts every expected name once, in any order', () => {
    expect(coversExactly(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(coversExactly([], [])).toBe(true)
  })

  test('rejects a missing, extra or repeated name', () => {
    expect(coversExactly(['a'], ['a', 'b'])).toBe(false)
    expect(coversExactly(['a', 'b', 'c'], ['a', 'b'])).toBe(false)
    expect(coversExactly(['a', 'a'], ['a', 'b'])).toBe(false)
    expect(coversExactly(['a', 'a', 'b'], ['a', 'b'])).toBe(false)
  })
})
