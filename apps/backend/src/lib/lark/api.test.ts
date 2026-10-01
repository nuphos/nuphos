// The resource path is built from event-payload values with the tenant token
// already attached, so a segment that rewrites the path reaches an arbitrary
// open-apis endpoint as us. Encoding alone does not stop it:
// encodeURIComponent('..') is '..', and new URL() then normalizes it away.
import { describe, expect, test } from 'bun:test'

import { isSafePathSegment } from './api'

describe('isSafePathSegment', () => {
  test('accepts the shapes Lark actually issues', () => {
    expect(isSafePathSegment('om_dc13264520392913993dd051dba21dcf')).toBe(true)
    expect(isSafePathSegment('file_v3_00g0_1a2b-3c4d')).toBe(true)
    expect(isSafePathSegment('img_v2_041b28e3')).toBe(true)
  })

  test('rejects traversal that survives percent-encoding', () => {
    // The case the encoding-only fix missed.
    expect(encodeURIComponent('..')).toBe('..')
    expect(isSafePathSegment('..')).toBe(false)
    expect(isSafePathSegment('../../v1/chats')).toBe(false)
  })

  test('rejects anything that could add a path segment or query', () => {
    for (const value of ['a/b', 'a%2Fb', 'a?b=1', 'a#b', 'a b', '', '.']) {
      expect(isSafePathSegment(value)).toBe(false)
    }
  })
})
