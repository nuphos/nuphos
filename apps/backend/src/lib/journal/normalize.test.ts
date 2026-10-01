import { describe, expect, test } from 'bun:test'

import { canonicalize } from './canonical'
import { toStorableJson } from './normalize'

// Simulates what the MongoDB driver does to a stored value:
// explicitly-undefined properties become null (ignoreUndefined: false) and lone
// surrogates are re-encoded to U+FFFD by the BSON UTF-8 encoder.
function bsonRoundTrip(value: unknown): unknown {
  if (typeof value === 'string') return value.toWellFormed()
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(bsonRoundTrip)

  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, v === undefined ? null : bsonRoundTrip(v)]),
  )
}

describe('toStorableJson', () => {
  test('is a fixed point of the BSON round trip', () => {
    const hostile = [
      {
        type: 'text',
        text: `sliced emoji: ${'💥'.slice(0, 1)}`,
        providerMetadata: undefined,
        nested: { keep: 'me', drop: undefined, nan: Number.NaN },
        items: ['a', undefined, 2],
      },
    ]
    const storable = toStorableJson(hostile)

    expect(bsonRoundTrip(storable)).toEqual(storable)
    expect(canonicalize(storable)).toBe(canonicalize(bsonRoundTrip(storable)))
  })

  test('drops undefined properties instead of letting the store null them', () => {
    expect(toStorableJson({ a: 1, b: undefined })).toEqual({ a: 1 })
  })

  test('replaces lone surrogates like the BSON encoder does', () => {
    const half = '💥'.slice(0, 1)

    expect(toStorableJson(half)).toBe('�')
    expect(toStorableJson('前面💥后面')).toBe('前面💥后面')
  })

  test('array holes and non-finite numbers follow JSON semantics', () => {
    expect(toStorableJson(['a', undefined, Number.NaN, Infinity])).toEqual(['a', null, null, null])
    // Sparse holes (skipped by .map) must also densify to null.
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3]

    expect(toStorableJson(sparse)).toEqual([1, null, 3])
    expect(canonicalize(toStorableJson(sparse))).toBe('[1,null,3]')
  })

  test('non-plain objects defer to their JSON form', () => {
    expect(toStorableJson(new Date('2026-07-06T00:00:00.000Z'))).toBe('2026-07-06T00:00:00.000Z')
    expect(toStorableJson(new Map([['a', 1]]))).toEqual({})
  })

  test('plain JSON passes through unchanged and canonicalize never throws', () => {
    const value = { text: '正常 emoji 💥', n: 1, list: [true, null, 'x'], nested: { k: 'v' } }
    const storable = toStorableJson(value)

    expect(storable).toEqual(value)
    expect(() => canonicalize(storable)).not.toThrow()
  })
})
