export type MongoDatabaseSummary = {
  name: string
  sizeOnDisk: number | null
  empty: boolean
}

export type MongoCollectionSummary = {
  name: string
  type: 'collection' | 'view' | 'timeseries'
  documentCount: number | null
  avgDocumentSize: number | null
  storageSize: number | null
  totalIndexSize: number | null
  indexCount: number | null
}

export type MongoSchemaField = {
  path: string
  presence: number
  occurrences: number
  types: { type: string; count: number }[]
}

export type MongoCollectionDetail = {
  database: string
  name: string
  type: MongoCollectionSummary['type']
  options: Record<string, unknown>
  stats: Omit<MongoCollectionSummary, 'name' | 'type'>
  indexes: {
    name: string
    keys: Record<string, unknown>
    unique: boolean
    sparse: boolean
    hidden: boolean
    expireAfterSeconds: number | null
    partial: boolean
    collation: boolean
  }[]
  indexesTruncated: boolean
  validation: {
    validator: Record<string, unknown> | null
    level: string | null
    action: string | null
    truncated: boolean
  }
  view: {
    source: string
    pipeline: Record<string, unknown>[]
    pipelineTruncated: boolean
  } | null
  sharding: {
    available: boolean
    sharded: boolean | null
    shardKey: Record<string, unknown> | null
    unique: boolean | null
    balancing: 'enabled' | 'disabled' | null
  }
  schema: {
    sampleSize: number
    fields: MongoSchemaField[]
    truncated: boolean
  }
  metadataTruncated: boolean
}
