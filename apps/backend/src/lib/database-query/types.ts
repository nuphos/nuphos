export const DATABASE_QUERY_TIMEOUT_MS = 10_000
export const DATABASE_QUERY_DEFAULT_LIMIT = 100
export const DATABASE_QUERY_MAX_LIMIT = 100
export const DATABASE_QUERY_MAX_RESPONSE_BYTES = 1_000_000

export type MongoReadOperation = 'find' | 'aggregate' | 'count' | 'explain'

export type MongoReadQuery = {
  operation: MongoReadOperation
  database: string
  collection: string
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, 1 | -1>
  pipeline?: Record<string, unknown>[]
  skip?: number
  limit?: number
}

export type DatabaseQueryResult = {
  operation: MongoReadOperation
  columns: string[]
  rows: unknown[]
  rowCount: number
  durationMs: number
  truncated: boolean
  truncationReason: 'row-limit' | 'response-size' | null
  nextSkip: number | null
  redactedFields: string[]
  executedAt: Date
}
