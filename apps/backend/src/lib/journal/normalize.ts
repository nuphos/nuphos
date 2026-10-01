// BSON round-trip normalization.
//
// Everything the journal hashes must be byte-identical to what MongoDB hands
// back on read, or every re-verification of the stored document reports
// divergence that looks like tampering. Two silent rewrites happen between an
// in-memory value and its stored form:
//
//   - explicitly-undefined properties are stored as null (the driver default
//     is ignoreUndefined: false), while JSON.stringify/canonicalize drop or
//     reject them — so the hash never saw the key the store round-trips
//   - lone surrogates (e.g. an emoji cut in half by a .slice() truncation)
//     are re-encoded to U+FFFD by the BSON UTF-8 encoder
//
// Writers must pass every hashed value through this BEFORE hashing and store
// the SAME normalized value, so hashed == stored == read-back.

import type { JsonValue } from './types'

export function toStorableJson(value: unknown): JsonValue {
  return storable(value) ?? null
}

/**
 * @returns the BSON-round-trippable JSON form of `value`, whose shape follows
 * the input's — string, number, boolean, array or plain object — or `undefined`
 * when the value has no JSON form at all and the caller must drop the key.
 */
function storable(value: unknown): JsonValue | undefined {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
      return value.toWellFormed()
    case 'boolean':
      return value
    case 'number':
      // JSON.stringify would emit null; BSON would store NaN/Infinity as-is.
      return Number.isFinite(value) ? value : null
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      return undefined
    case 'object':
      break
  }
  if (Array.isArray(value)) {
    // JSON semantics: unserializable items become null, never a gap. Indexed
    // iteration (not .map, which skips sparse holes) so `[1, , 3]` really
    // normalizes to [1, null, 3].
    return Array.from({ length: value.length }, (_, i) => storable(value[i]) ?? null)
  }
  const proto = Object.getPrototypeOf(value)

  if (proto !== Object.prototype && proto !== null) {
    // Date/Map/class instances: defer to their JSON form (toJSON or {}) so
    // the result is a plain value the store cannot reinterpret.
    try {
      // A toJSON returning undefined makes JSON.stringify return undefined,
      // which the lib types do not admit.
      const json = JSON.stringify(value)

      return typeof json === 'string' ? storable(JSON.parse(json)) : undefined
    } catch {
      return storable(Object.prototype.toString.call(value))
    }
  }
  const out: Record<string, JsonValue> = {}

  for (const [key, item] of Object.entries(value)) {
    const safe = storable(item)

    if (safe !== undefined) out[key.toWellFormed()] = safe
  }

  return out
}
