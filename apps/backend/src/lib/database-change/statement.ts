import { createHash } from 'node:crypto'

import { BSON } from 'mongodb'

import type { DatabaseChangeKind, MongoDatabaseChangeOperation } from '@/models'

export const DATABASE_CHANGE_TIMEOUT_MS = 15_000
export const DATABASE_CHANGE_MAX_AFFECTED_DOCUMENTS = 10_000
export const DATABASE_CHANGE_MAX_INSERT_DOCUMENTS = 1_000

const PREVIEW_MAX_BYTES = 64_000
const REDACTED_VALUE = '[REDACTED]'
const SYSTEM_DATABASES = new Set(['admin', 'config', 'local'])
const FORBIDDEN_OPERATORS = new Set(['$where', '$function', '$accumulator'])
const ALLOWED_UPDATE_OPERATORS = new Set([
  '$addToSet',
  '$bit',
  '$currentDate',
  '$inc',
  '$max',
  '$min',
  '$mul',
  '$pop',
  '$pull',
  '$push',
  '$rename',
  '$set',
  '$unset',
])
const SENSITIVE_FIELD =
  /(password|passwd|pwd|secret|token|apikey|authorization|cookie|privatekey|connectionuri|connectionstring|credential|email|phone|mobile|address|ssn|socialsecurity|idcard|creditcard)/i
// Two patterns rather than one alternation: the first is anchored, the second
// is not, and spelling that out keeps either half readable on its own.
const SENSITIVE_VALUE_PREFIX =
  /^(?:bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+|-----BEGIN [^-]*PRIVATE KEY-----)/i
const SENSITIVE_VALUE_URI = /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^\s/:@]+:[^\s@]+@/i

function looksSensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE_PREFIX.test(value) || SENSITIVE_VALUE_URI.test(value)
}

export type MongoDatabaseChangeStatement = {
  operation: MongoDatabaseChangeOperation
  database: string
  collection: string
  document?: Record<string, unknown>
  documents?: Record<string, unknown>[]
  filter?: Record<string, unknown>
  update?: Record<string, unknown>
  indexKeys?: Record<string, 1 | -1 | 'text' | 'hashed'>
  indexName?: string
  unique?: boolean
  sparse?: boolean
}

function assertSafeNamespace(statement: MongoDatabaseChangeStatement): void {
  if (SYSTEM_DATABASES.has(statement.database.toLowerCase())) {
    throw new Error('Mutations of MongoDB system databases are not allowed by the change gateway.')
  }
  if (statement.collection.startsWith('system.')) {
    throw new Error(
      'Mutations of MongoDB system collections are not allowed by the change gateway.',
    )
  }
}

function assertNoForbiddenOperator(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenOperator)

    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_OPERATORS.has(key)) {
      throw new Error(`Operator ${key} is not allowed by the database change gateway.`)
    }
    assertNoForbiddenOperator(child)
  }
}

function assertBoundedDocument(value: unknown, label: string, maxBytes = 256_000): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')

  if (bytes > maxBytes)
    throw new Error(`${label} exceeds the ${String(maxBytes)}-byte change gateway limit.`)
}

function assertNonEmptyFilter(filter: Record<string, unknown> | undefined): void {
  if (!filter || Object.keys(filter).length === 0) {
    throw new Error('MongoDB update and delete requests require a non-empty filter.')
  }
}

export function mongoChangeKind(operation: MongoDatabaseChangeOperation): DatabaseChangeKind {
  return operation === 'createCollection' ||
    operation === 'dropCollection' ||
    operation === 'createIndex' ||
    operation === 'dropIndex'
    ? 'ddl'
    : 'dml'
}

export function assertMongoChangeStatement(statement: MongoDatabaseChangeStatement): void {
  assertSafeNamespace(statement)
  assertNoForbiddenOperator(statement)
  assertBoundedDocument(statement, 'MongoDB change statement', 512_000)

  switch (statement.operation) {
    case 'insertOne':
      if (!statement.document || Array.isArray(statement.document))
        throw new Error('insertOne requires one document.')
      assertBoundedDocument(statement.document, 'MongoDB insert document')
      break
    case 'insertMany':
      if (!statement.documents?.length)
        throw new Error('insertMany requires at least one document.')
      if (statement.documents.length > DATABASE_CHANGE_MAX_INSERT_DOCUMENTS) {
        throw new Error(
          `insertMany is limited to ${String(DATABASE_CHANGE_MAX_INSERT_DOCUMENTS)} documents per approved request.`,
        )
      }
      break
    case 'updateOne':
    case 'updateMany': {
      assertNonEmptyFilter(statement.filter)
      const operators = Object.keys(statement.update ?? {})

      if (
        !operators.length ||
        operators.some((key) => !key.startsWith('$') || !ALLOWED_UPDATE_OPERATORS.has(key))
      ) {
        throw new Error(
          'Updates must use the allowlisted MongoDB update operators; replacement and pipeline updates are not allowed.',
        )
      }
      break
    }
    case 'deleteOne':
    case 'deleteMany':
      assertNonEmptyFilter(statement.filter)
      break
    case 'createCollection':
    case 'dropCollection':
      break
    case 'createIndex':
      if (!statement.indexKeys || Object.keys(statement.indexKeys).length === 0) {
        throw new Error('createIndex requires at least one index key.')
      }
      if (Object.keys(statement.indexKeys).length > 32)
        throw new Error('createIndex is limited to 32 index keys.')
      break
    case 'dropIndex':
      if (!statement.indexName?.trim()) throw new Error('dropIndex requires an index name.')
      if (statement.indexName === '_id_')
        throw new Error('The MongoDB _id index cannot be dropped.')
      break
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]),
  )
}

export function mongoChangeStatementDigest(statement: MongoDatabaseChangeStatement): string {
  assertMongoChangeStatement(statement)

  return createHash('sha256')
    .update(JSON.stringify(canonical(statement)))
    .digest('hex')
}

function redact(value: unknown, path: string, redacted: Set<string>): unknown {
  if (typeof value === 'string' && looksSensitiveValue(value)) {
    redacted.add(path || '$value')

    return REDACTED_VALUE
  }
  if (Array.isArray(value))
    return value.map((child, index) => redact(child, `${path}.${String(index)}`, redacted))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      const childPath = path ? `${path}.${key}` : key

      if (SENSITIVE_FIELD.test(key.replace(/[^a-z0-9]/gi, ''))) {
        redacted.add(childPath)

        return [key, REDACTED_VALUE]
      }

      return [key, redact(child, childPath, redacted)]
    }),
  )
}

export function mongoChangeStatementPreview(statement: MongoDatabaseChangeStatement): {
  statement: string
  redactedFields: string[]
  truncated: boolean
} {
  assertMongoChangeStatement(statement)
  const redacted = new Set<string>()
  const rendered = BSON.EJSON.stringify(redact(statement, '', redacted), undefined, 2, {
    relaxed: true,
  })

  if (Buffer.byteLength(rendered, 'utf8') <= PREVIEW_MAX_BYTES) {
    return {
      statement: rendered,
      redactedFields: [...redacted].sort((a, b) => a.localeCompare(b)),
      truncated: false,
    }
  }

  return {
    statement: `${Buffer.from(rendered).subarray(0, PREVIEW_MAX_BYTES).toString('utf8')}\n/* statement preview truncated */`,
    redactedFields: [...redacted].sort((a, b) => a.localeCompare(b)),
    truncated: true,
  }
}
