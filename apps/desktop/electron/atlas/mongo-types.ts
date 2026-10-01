export type MongoDatabaseCatalog = {
  databases: { name: string; sizeOnDisk: number | null; empty: boolean }[]
  truncated: boolean
  fetchedAt: string
}

export type MongoMonitoringCapability = 'available' | 'unsupported' | 'permission-denied' | 'error'
export type MongoMonitoringMetrics = {
  connectionsCurrent: number | null
  connectionsAvailable: number | null
  connectionsTotalCreated: number | null
  operationsQueryTotal: number | null
  operationsInsertTotal: number | null
  operationsUpdateTotal: number | null
  operationsDeleteTotal: number | null
  operationsCommandTotal: number | null
  readLatencyMicrosTotal: number | null
  readLatencyOpsTotal: number | null
  writeLatencyMicrosTotal: number | null
  writeLatencyOpsTotal: number | null
  commandLatencyMicrosTotal: number | null
  commandLatencyOpsTotal: number | null
  networkBytesInTotal: number | null
  networkBytesOutTotal: number | null
  networkRequestsTotal: number | null
  memoryResidentBytes: number | null
  memoryVirtualBytes: number | null
  wiredTigerCacheBytes: number | null
  wiredTigerCacheMaxBytes: number | null
  wiredTigerDirtyBytes: number | null
  wiredTigerPagesReadTotal: number | null
  wiredTigerPagesWrittenTotal: number | null
  queueReaders: number | null
  queueWriters: number | null
  replicationLagSeconds: number | null
  replicationMembers: number | null
  replicationHealthyMembers: number | null
  uptimeSeconds: number | null
}
export type MongoMonitoringRates = {
  queryPerSecond: number | null
  insertPerSecond: number | null
  updatePerSecond: number | null
  deletePerSecond: number | null
  commandPerSecond: number | null
  bytesInPerSecond: number | null
  bytesOutPerSecond: number | null
  readLatencyMicros: number | null
  writeLatencyMicros: number | null
  commandLatencyMicros: number | null
}
export type MongoMonitoringSample = {
  id: string
  sampledAt: string
  durationMs: number
  source: 'mongodb-direct'
  deploymentType: 'standalone' | 'replica-set' | 'sharded' | 'unknown'
  process: string | null
  node: string | null
  replicaSetName: string | null
  capabilities: {
    serverStatus: MongoMonitoringCapability
    wiredTiger: MongoMonitoringCapability
    opLatencies: MongoMonitoringCapability
    queues: MongoMonitoringCapability
    replication: MongoMonitoringCapability
  }
  metrics: MongoMonitoringMetrics
  rates: MongoMonitoringRates
  replicaMembers: {
    name: string
    state: string
    health: number | null
    self: boolean
    lagSeconds: number | null
  }[]
}
export type MongoMonitoringHistory = { samples: MongoMonitoringSample[]; retentionDays: number }

export type MongoCollectionSummary = {
  name: string
  type: 'collection' | 'view' | 'timeseries'
  documentCount: number | null
  avgDocumentSize: number | null
  storageSize: number | null
  totalIndexSize: number | null
  indexCount: number | null
}

export type MongoCollectionCatalog = {
  database: string
  collections: MongoCollectionSummary[]
  truncated: boolean
  fetchedAt: string
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
    fields: {
      path: string
      presence: number
      occurrences: number
      types: { type: string; count: number }[]
    }[]
    truncated: boolean
  }
  metadataTruncated: boolean
}

export type MongoReadQueryInput = {
  operation: 'find' | 'aggregate' | 'count' | 'explain'
  database: string
  collection: string
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, 1 | -1>
  pipeline?: Record<string, unknown>[]
  skip?: number
  limit?: number
}
