// Canonical JSON serialization for journal hashing (RFC 8785 / JCS style).
//
// The entire chain's recomputability rests on this function being stable
// forever: same value in, byte-identical string out, across runtimes and
// releases. Behavior is frozen by golden tests in canonical.test.ts — any
// change that alters existing output requires a new JOURNAL_SCHEMA_VERSION.
//
// Rules:
// - object keys sorted by UTF-16 code units (JCS ordering)
// - no whitespace
// - strings/numbers serialized via JSON.stringify (ES shortest round-trip
//   number form, which matches RFC 8785 for the values we accept)
// - rejects: undefined, functions, symbols, bigint, NaN, ±Infinity, and any
//   non-plain object (Date, Map, class instances...) — journal payloads must
//   be pre-serialized to plain JSON by the caller, silently coercing would
//   make hashes depend on incidental runtime types.

export class JournalCanonicalizeError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path || '$'})`)
    this.name = 'JournalCanonicalizeError'
  }
}

export function canonicalize(value: unknown): string {
  return serialize(value, '')
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new JournalCanonicalizeError(`non-finite number ${String(value)}`, path)
      }

      return JSON.stringify(value)
    case 'undefined':
      throw new JournalCanonicalizeError('undefined is not canonicalizable', path)
    case 'bigint':
      throw new JournalCanonicalizeError('bigint is not canonicalizable', path)
    case 'function':
    case 'symbol':
      throw new JournalCanonicalizeError(`${typeof value} is not canonicalizable`, path)
    case 'object':
      break
  }

  if (Array.isArray(value)) {
    const items = value.map((item, i) => serialize(item, `${path}[${String(i)}]`))

    return `[${items.join(',')}]`
  }

  const proto = Object.getPrototypeOf(value)

  if (proto !== Object.prototype && proto !== null) {
    throw new JournalCanonicalizeError(
      'non-plain object is not canonicalizable (pre-serialize to plain JSON)',
      path,
    )
  }

  const record = value as Record<string, unknown>
  // Code-unit order, not localeCompare: JCS mandates it and the chain's
  // hashes depend on it.
  const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const parts: string[] = []

  for (const key of keys) {
    const item = record[key]

    if (item === undefined) {
      // Reject rather than skip: a skipped key would make {a: undefined} and
      // {} hash identically while JSON.stringify round-trips them differently.
      throw new JournalCanonicalizeError(`undefined value for key "${key}"`, path)
    }
    const child = serialize(item, `${path}.${key}`)

    parts.push(`${JSON.stringify(key)}:${child}`)
  }

  return `{${parts.join(',')}}`
}
