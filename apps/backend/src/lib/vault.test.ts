import { describe, expect, it } from 'bun:test'

import { distinctWithin } from '@/lib/vault'

describe('distinctWithin', () => {
  it('accepts some of the allowed names, each once', () => {
    expect(distinctWithin(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(distinctWithin(['a'], ['a', 'b'])).toBe(true)
    expect(distinctWithin([], ['a'])).toBe(true)
  })

  it('refuses a repeated or unknown name', () => {
    expect(distinctWithin(['a', 'c'], ['a', 'b'])).toBe(false)
    expect(distinctWithin(['a', 'a'], ['a', 'b'])).toBe(false)
  })
})
