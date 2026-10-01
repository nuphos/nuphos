import { REDACTED_VALUE } from '@/lib/database-query/sanitize'
import { DATABASE_QUERY_DEFAULT_LIMIT, DATABASE_QUERY_MAX_LIMIT } from '@/lib/database-query/types'

import type { MongoReadQuery } from '@/lib/database-query/types'

const SENSITIVE_AUDIT_FIELD =
  /(password|passwd|pwd|secret|token|apikey|authorization|cookie|privatekey|connectionuri|connectionstring|credential|email|phone|mobile|address|ssn|socialsecurity|idcard|creditcard)/i
// Two patterns rather than one alternation: the first is anchored, the second
// is not, and spelling that out keeps either half readable on its own.
const SENSITIVE_AUDIT_VALUE_PREFIX =
  /^(?:bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+|-----BEGIN [^-]*PRIVATE KEY-----)/i
const SENSITIVE_AUDIT_VALUE_URI =
  /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^\s/:@]+:[^\s@]+@/i

function looksSensitiveValue(value: string): boolean {
  return SENSITIVE_AUDIT_VALUE_PREFIX.test(value) || SENSITIVE_AUDIT_VALUE_URI.test(value)
}
const DATABASE_QUERY_MAX_AUDIT_STATEMENT_BYTES = 64_000

function redactAuditValue(value: unknown, path: string, redacted: Set<string>): unknown {
  if (typeof value === 'string' && looksSensitiveValue(value)) {
    redacted.add(path || '$value')

    return REDACTED_VALUE
  }
  if (Array.isArray(value))
    return value.map((entry, index) =>
      redactAuditValue(entry, `${path}.${String(index)}`, redacted),
    )
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key

    if (SENSITIVE_AUDIT_FIELD.test(key.replace(/[^a-z0-9]/gi, ''))) {
      output[key] = REDACTED_VALUE
      redacted.add(childPath)
    } else {
      output[key] = redactAuditValue(child, childPath, redacted)
    }
  }

  return output
}

function redactAuditScalarValues(value: unknown, path: string, redacted: Set<string>): unknown {
  if (typeof value === 'string' && looksSensitiveValue(value)) {
    redacted.add(path || '$value')

    return REDACTED_VALUE
  }
  if (Array.isArray(value))
    return value.map((entry, index) =>
      redactAuditScalarValues(entry, `${path}.${String(index)}`, redacted),
    )
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      redactAuditScalarValues(child, path ? `${path}.${key}` : key, redacted),
    ]),
  )
}

function redactAuditPipeline(
  pipeline: Record<string, unknown>[],
  redacted: Set<string>,
): Record<string, unknown>[] {
  return pipeline.map((stage, index) =>
    Object.fromEntries(
      Object.entries(stage).map(([operator, value]) => {
        const path = `pipeline.${String(index)}.${operator}`
        const shapeOnly = operator === '$project' || operator === '$sort' || operator === '$unset'

        return [
          operator,
          shapeOnly
            ? redactAuditScalarValues(value, path, redacted)
            : redactAuditValue(value, path, redacted),
        ]
      }),
    ),
  )
}

function formatAuditDocument(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function boundAuditStatement(statement: string): { statement: string; truncated: boolean } {
  if (Buffer.byteLength(statement, 'utf8') <= DATABASE_QUERY_MAX_AUDIT_STATEMENT_BYTES) {
    return { statement, truncated: false }
  }

  return {
    statement: `${Buffer.from(statement).subarray(0, DATABASE_QUERY_MAX_AUDIT_STATEMENT_BYTES).toString('utf8')}\n/* audit statement truncated */`,
    truncated: true,
  }
}

/**
 * Produces an operator-readable MongoDB statement for query history and audit.
 * The returned statement is sanitized before persistence and must never be
 * replaced with the raw request body in logs or audit storage.
 */
export function mongoAuditStatement(query: MongoReadQuery): {
  statement: string
  redactedFields: string[]
  truncated: boolean
  queryInput: MongoReadQuery | null
} {
  const redacted = new Set<string>()
  const filter = redactAuditValue(query.filter ?? {}, 'filter', redacted)
  const projection = redactAuditScalarValues(
    query.projection ?? {},
    'projection',
    redacted,
  ) as Record<string, unknown>
  const sort = query.sort ?? {}
  const pipeline = redactAuditPipeline(query.pipeline ?? [], redacted)
  const skip = query.skip ?? 0
  const limit = Math.min(query.limit ?? DATABASE_QUERY_DEFAULT_LIMIT, DATABASE_QUERY_MAX_LIMIT)
  const collection = JSON.stringify(query.collection)
  let statement: string

  if (query.operation === 'aggregate') {
    statement = `db.getCollection(${collection}).aggregate(${formatAuditDocument(pipeline)})\n  .skip(${String(skip)})\n  .limit(${String(limit)})`
  } else if (query.operation === 'count') {
    statement = `db.getCollection(${collection}).countDocuments(${formatAuditDocument(filter)}, { limit: ${String(DATABASE_QUERY_MAX_LIMIT + 1)} })`
  } else {
    const base = `db.getCollection(${collection}).find(${formatAuditDocument(filter)}, ${formatAuditDocument(projection)})\n  .sort(${formatAuditDocument(sort)})\n  .skip(${String(skip)})\n  .limit(${String(limit)})`

    statement = query.operation === 'explain' ? `${base}\n  .explain("executionStats")` : base
  }
  const queryInput: MongoReadQuery = {
    operation: query.operation,
    database: query.database,
    collection: query.collection,
    filter: filter as Record<string, unknown>,
    projection,
    sort: { ...sort },
    pipeline,
    skip,
    limit,
  }

  return {
    ...boundAuditStatement(statement),
    redactedFields: [...redacted].sort((a, b) => a.localeCompare(b)),
    queryInput:
      Buffer.byteLength(JSON.stringify(queryInput), 'utf8') <=
      DATABASE_QUERY_MAX_AUDIT_STATEMENT_BYTES
        ? queryInput
        : null,
  }
}
