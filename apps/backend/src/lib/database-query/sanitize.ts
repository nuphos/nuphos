import { BSON } from 'mongodb'

import { DATABASE_QUERY_MAX_RESPONSE_BYTES } from '@/lib/database-query/types'

export const REDACTED_VALUE = '[REDACTED]'

const SENSITIVE_FIELD =
  /(password|passwd|pwd|secret|token|apikey|authorization|cookie|privatekey|connectionuri|connectionstring|credential)/i

function redactValue(value: unknown, path: string, redacted: Set<string>): unknown {
  if (Array.isArray(value))
    return value.map((entry, index) => redactValue(entry, `${path}.${String(index)}`, redacted))
  if (!value || typeof value !== 'object') return value
  if (value instanceof Date || Buffer.isBuffer(value) || value instanceof Uint8Array) return value
  const bsonType = (value as { _bsontype?: unknown })._bsontype

  if (typeof bsonType === 'string') return value
  const output: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key

    if (SENSITIVE_FIELD.test(key.replace(/[^a-z0-9]/gi, ''))) {
      output[key] = REDACTED_VALUE
      redacted.add(childPath)
    } else {
      output[key] = redactValue(child, childPath, redacted)
    }
  }

  return output
}

function serialized(value: unknown): unknown {
  return BSON.EJSON.serialize(value, { relaxed: true })
}

export function sanitizeMongoRows(values: unknown[]): {
  rows: unknown[]
  redactedFields: string[]
} {
  const redacted = new Set<string>()

  return {
    rows: values.map((row) => serialized(redactValue(row, '', redacted))),
    redactedFields: [...redacted].sort((a, b) => a.localeCompare(b)),
  }
}

export function boundQueryRows(
  values: unknown[],
  maxBytes = DATABASE_QUERY_MAX_RESPONSE_BYTES,
): {
  rows: unknown[]
  bytes: number
  truncated: boolean
} {
  const rows: unknown[] = []
  let bytes = 2

  for (const value of values) {
    const json = JSON.stringify(value)
    const nextBytes = Buffer.byteLength(json, 'utf8') + (rows.length ? 1 : 0)

    if (rows.length > 0 && bytes + nextBytes > maxBytes) return { rows, bytes, truncated: true }
    if (rows.length === 0 && bytes + nextBytes > maxBytes)
      return { rows: [], bytes, truncated: true }
    rows.push(value)
    bytes += nextBytes
  }

  return { rows, bytes, truncated: false }
}

export function columnsFor(rows: unknown[]): string[] {
  const columns = new Set<string>()

  for (const row of rows.slice(0, 100)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    Object.keys(row as Record<string, unknown>).forEach((key) => columns.add(key))
  }

  return [...columns]
}

export function bsonResponseSize(value: unknown): number {
  try {
    return BSON.calculateObjectSize({ value })
  } catch {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  }
}
