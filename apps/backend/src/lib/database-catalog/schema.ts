import type { MongoCollectionDetail } from '@/lib/database-catalog/types'
import type { Document } from 'mongodb'

export const SCHEMA_SAMPLE_SIZE = 100

const MAX_SCHEMA_FIELDS = 250
const MAX_SCHEMA_DEPTH = 6

function bsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return 'binData'
  const bsonName = typeof value === 'object' ? (value as { _bsontype?: unknown })._bsontype : null

  if (typeof bsonName === 'string') {
    const names: Record<string, string> = {
      ObjectId: 'objectId',
      Decimal128: 'decimal',
      Long: 'long',
      Int32: 'int',
      Double: 'double',
      Timestamp: 'timestamp',
      Binary: 'binData',
      BSONRegExp: 'regex',
      MinKey: 'minKey',
      MaxKey: 'maxKey',
      Code: 'javascript',
      DBRef: 'dbPointer',
    }

    return names[bsonName] ?? bsonName
  }
  if (typeof value === 'number') return 'double'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'object') return 'object'

  return typeof value
}

type MutableField = {
  documents: Set<number>
  occurrences: number
  types: Map<string, number>
}

function observe(
  fields: Map<string, MutableField>,
  path: string,
  value: unknown,
  documentIndex: number,
): void {
  if (!fields.has(path) && fields.size >= MAX_SCHEMA_FIELDS) return
  const field = fields.get(path) ?? {
    documents: new Set<number>(),
    occurrences: 0,
    types: new Map<string, number>(),
  }

  field.documents.add(documentIndex)
  field.occurrences += 1
  const type = bsonType(value)

  field.types.set(type, (field.types.get(type) ?? 0) + 1)
  fields.set(path, field)
}

function walkValue(
  fields: Map<string, MutableField>,
  value: unknown,
  path: string,
  documentIndex: number,
  depth: number,
): void {
  observe(fields, path, value, documentIndex)
  if (depth >= MAX_SCHEMA_DEPTH || value === null) return
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) {
      const itemPath = `${path}[]`

      observe(fields, itemPath, item, documentIndex)
      if (item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date)) {
        for (const [key, nested] of Object.entries(item as Record<string, unknown>)) {
          walkValue(fields, nested, `${itemPath}.${key}`, documentIndex, depth + 1)
        }
      }
    }

    return
  }
  if (typeof value === 'object' && !(value instanceof Date) && bsonType(value) === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      walkValue(fields, nested, `${path}.${key}`, documentIndex, depth + 1)
    }
  }
}

export function inferMongoSchema(documents: Document[]): MongoCollectionDetail['schema'] {
  const fields = new Map<string, MutableField>()

  documents.forEach((document, documentIndex) => {
    for (const [key, value] of Object.entries(document)) {
      walkValue(fields, value, key, documentIndex, 0)
    }
  })

  return {
    sampleSize: documents.length,
    fields: [...fields.entries()]
      .map(([path, field]) => ({
        path,
        presence: documents.length === 0 ? 0 : field.documents.size / documents.length,
        occurrences: field.occurrences,
        types: [...field.types.entries()]
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    truncated: fields.size >= MAX_SCHEMA_FIELDS,
  }
}
