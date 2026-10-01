import type { DatabaseChangeRequest, MongoDatabaseChangeStatement } from '../../types'

export type Operation = MongoDatabaseChangeStatement['operation']

export const OPERATIONS: { value: Operation; label: string; kind: 'DML' | 'DDL' }[] = [
  { value: 'insertOne', label: 'Insert one', kind: 'DML' },
  { value: 'insertMany', label: 'Insert many', kind: 'DML' },
  { value: 'updateOne', label: 'Update one', kind: 'DML' },
  { value: 'updateMany', label: 'Update many', kind: 'DML' },
  { value: 'deleteOne', label: 'Delete one', kind: 'DML' },
  { value: 'deleteMany', label: 'Delete many', kind: 'DML' },
  { value: 'createCollection', label: 'Create collection', kind: 'DDL' },
  { value: 'dropCollection', label: 'Drop collection', kind: 'DDL' },
  { value: 'createIndex', label: 'Create index', kind: 'DDL' },
  { value: 'dropIndex', label: 'Drop index', kind: 'DDL' },
]

export const inputClass =
  'w-full rounded-md border border-zGray-800 bg-field px-2.5 py-1.5 text-[12px] text-main outline-none focus:border-zViolet-accent'
export const textareaClass = `${inputClass} min-h-24 resize-y font-mono leading-5`

function parseObject(label: string, source: string): Record<string, unknown> {
  const value = JSON.parse(source) as unknown

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be a JSON object.`)

  return value as Record<string, unknown>
}

function parseDocuments(source: string): Record<string, unknown>[] {
  const value = JSON.parse(source) as unknown

  if (
    !Array.isArray(value) ||
    value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))
  ) {
    throw new Error('Documents must be a JSON array of objects.')
  }

  return value as Record<string, unknown>[]
}

export function previewValue(change: DatabaseChangeRequest): unknown {
  try {
    return JSON.parse(change.statementPreview)
  } catch {
    return { statement: change.statementPreview }
  }
}

export function buildStatement({
  operation,
  database,
  collection,
  filter,
  payload,
  indexName,
  unique,
  sparse,
}: {
  operation: Operation
  database: string
  collection: string
  filter: string
  payload: string
  indexName: string
  unique: boolean
  sparse: boolean
}): MongoDatabaseChangeStatement {
  const base = {
    operation,
    database: database.trim(),
    collection: collection.trim(),
  } as MongoDatabaseChangeStatement

  if (operation === 'insertOne')
    return { ...base, operation, document: parseObject('Document', payload) }
  if (operation === 'insertMany') return { ...base, operation, documents: parseDocuments(payload) }
  if (operation === 'updateOne' || operation === 'updateMany')
    return {
      ...base,
      operation,
      filter: parseObject('Filter', filter),
      update: parseObject('Update', payload),
    }
  if (operation === 'deleteOne' || operation === 'deleteMany')
    return { ...base, operation, filter: parseObject('Filter', filter) }
  if (operation === 'createIndex')
    return {
      ...base,
      operation,
      indexKeys: parseObject('Index keys', payload) as Record<string, 1 | -1 | 'text' | 'hashed'>,
      ...(indexName.trim() ? { indexName: indexName.trim() } : {}),
      unique,
      sparse,
    }
  if (operation === 'dropIndex') return { ...base, operation, indexName: indexName.trim() }

  return base
}
