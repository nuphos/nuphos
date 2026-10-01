export const MONGO_MONITOR_TIMEOUT_MS = 5_000
export const MONGO_MONITOR_MIN_SAMPLE_INTERVAL_MS = 10_000
export const MONGO_MONITOR_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export type MonitoringCapabilityState = 'available' | 'unsupported' | 'permission-denied' | 'error'

export type MongoDeploymentType = 'standalone' | 'replica-set' | 'sharded' | 'unknown'

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

export type MongoMonitoringReplicaMember = {
  name: string
  state: string
  health: number | null
  self: boolean
  lagSeconds: number | null
}

export type MongoMonitoringSnapshot = {
  sampledAt: Date
  durationMs: number
  source: 'mongodb-direct'
  deploymentType: MongoDeploymentType
  process: string | null
  node: string | null
  replicaSetName: string | null
  capabilities: {
    serverStatus: MonitoringCapabilityState
    wiredTiger: MonitoringCapabilityState
    opLatencies: MonitoringCapabilityState
    queues: MonitoringCapabilityState
    replication: MonitoringCapabilityState
  }
  metrics: MongoMonitoringMetrics
  replicaMembers: MongoMonitoringReplicaMember[]
}

export type JsonRecord = Record<string, unknown>
