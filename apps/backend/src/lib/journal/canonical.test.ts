import { describe, expect, test } from 'bun:test'

import { JournalCanonicalizeError, canonicalize } from './canonical'
import { hmacSha256Hex, sha256Hex } from './hashing'

// GOLDEN TESTS — these outputs are frozen forever. The whole journal chain's
// recomputability depends on canonicalize() never changing behavior for
// existing values. If a change breaks one of these, you are breaking every
// previously written journal entry: bump JOURNAL_SCHEMA_VERSION instead.

describe('canonicalize golden vectors', () => {
  test('sorts object keys', () => {
    expect(canonicalize({ b: 1, a: 'x' })).toBe('{"a":"x","b":1}')
  })

  test('nested objects, arrays, unicode and escapes', () => {
    expect(canonicalize({ s: '中文 ✓ "quoted"\n', nested: { z: true, y: [1, 2, null] } })).toBe(
      '{"nested":{"y":[1,2,null],"z":true},"s":"中文 ✓ \\"quoted\\"\\n"}',
    )
  })

  test('numbers use ES shortest round-trip form; -0 collapses to 0', () => {
    expect(canonicalize([1.5, 1e21, -0, 0.30000000000000004])).toBe(
      '[1.5,1e+21,0,0.30000000000000004]',
    )
  })

  test('empty containers and scalars', () => {
    expect(canonicalize({})).toBe('{}')
    expect(canonicalize([])).toBe('[]')
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(true)).toBe('true')
    expect(canonicalize('')).toBe('""')
  })

  test('sha256 golden', () => {
    expect(sha256Hex('hello journal')).toBe(
      '252fa500843b227a56da6c1f5b084aab6919bf2dc4be0a42be45f7500a7fc624',
    )
  })

  test('hmac golden (keyed digest differs from plain sha256)', () => {
    const digest = hmacSha256Hex('test-hmac-key-v1', 'kubectl delete pod api-0 --token secret123')

    expect(digest).toBe('ead106a8a700f3341e4650c8b685ac733566af1d4d16022ec899ec4c97331c5c')
    expect(digest).not.toBe(sha256Hex('kubectl delete pod api-0 --token secret123'))
  })
})

describe('canonicalize rejections', () => {
  test('rejects undefined, NaN, Infinity, bigint', () => {
    expect(() => canonicalize(undefined)).toThrow(JournalCanonicalizeError)
    expect(() => canonicalize(NaN)).toThrow(JournalCanonicalizeError)
    expect(() => canonicalize(Infinity)).toThrow(JournalCanonicalizeError)
    expect(() => canonicalize(-Infinity)).toThrow(JournalCanonicalizeError)
    expect(() => canonicalize(1n)).toThrow(JournalCanonicalizeError)
  })

  test('rejects undefined object values instead of silently skipping the key', () => {
    expect(() => canonicalize({ a: undefined })).toThrow(JournalCanonicalizeError)
  })

  test('rejects non-plain objects (Date, Map, class instances)', () => {
    expect(() => canonicalize(new Date())).toThrow(JournalCanonicalizeError)
    expect(() => canonicalize(new Map())).toThrow(JournalCanonicalizeError)
    class Thing {
      readonly kind = 'thing'
    }
    expect(() => canonicalize(new Thing())).toThrow(JournalCanonicalizeError)
  })

  test('rejects nested garbage with a useful path', () => {
    try {
      canonicalize({ ok: 1, bad: [{ deep: undefined }] })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(JournalCanonicalizeError)
      expect((error as JournalCanonicalizeError).message).toContain('.bad[0]')
    }
  })

  test('null-prototype objects are accepted as plain', () => {
    const obj = Object.create(null) as Record<string, unknown>

    obj.a = 1
    expect(canonicalize(obj)).toBe('{"a":1}')
  })
})
