import { MongoServerError } from 'mongodb'

import type {
  JsonRecord,
  MongoMonitoringMetrics,
  MongoMonitoringReplicaMember,
  MongoMonitoringSnapshot,
  MonitoringCapabilityState,
} from '@/lib/database-monitoring/types'

export function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function path(value: unknown, ...keys: string[]): unknown {
  let current = value

  for (const key of keys) current = record(current)[key]

  return current
}

/** Mongo's Long / Decimal128 carry their value in a real toString; a plain object does not. */
function hasOwnToString(value: unknown): value is { toString: () => string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { toString: unknown }).toString !== Object.prototype.toString
  )
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') {
    const converted = Number(value)

    return Number.isSafeInteger(converted) ? converted : null
  }
  if (hasOwnToString(value)) {
    const converted = Number(value.toString())

    return Number.isFinite(converted) ? converted : null
  }

  return null
}

function mbToBytes(value: unknown): number | null {
  const number = finiteNumber(value)

  return number === null ? null : number * 1024 * 1024
}

export function emptyMetrics(): MongoMonitoringMetrics {
  return {
    connectionsCurrent: null,
    connectionsAvailable: null,
    connectionsTotalCreated: null,
    operationsQueryTotal: null,
    operationsInsertTotal: null,
    operationsUpdateTotal: null,
    operationsDeleteTotal: null,
    operationsCommandTotal: null,
    readLatencyMicrosTotal: null,
    readLatencyOpsTotal: null,
    writeLatencyMicrosTotal: null,
    writeLatencyOpsTotal: null,
    commandLatencyMicrosTotal: null,
    commandLatencyOpsTotal: null,
    networkBytesInTotal: null,
    networkBytesOutTotal: null,
    networkRequestsTotal: null,
    memoryResidentBytes: null,
    memoryVirtualBytes: null,
    wiredTigerCacheBytes: null,
    wiredTigerCacheMaxBytes: null,
    wiredTigerDirtyBytes: null,
    wiredTigerPagesReadTotal: null,
    wiredTigerPagesWrittenTotal: null,
    queueReaders: null,
    queueWriters: null,
    replicationLagSeconds: null,
    replicationMembers: null,
    replicationHealthyMembers: null,
    uptimeSeconds: null,
  }
}

export function capabilityError(error: unknown): MonitoringCapabilityState {
  if (
    error instanceof MongoServerError &&
    (error.code === 13 || /not authorized|unauthorized/i.test(error.message))
  ) {
    return 'permission-denied'
  }

  return 'error'
}

export function normalizeMongoServerStatus(status: JsonRecord): {
  metrics: MongoMonitoringMetrics
  capabilities: Pick<
    MongoMonitoringSnapshot['capabilities'],
    'serverStatus' | 'wiredTiger' | 'opLatencies' | 'queues'
  >
  process: string | null
} {
  const cache = path(status, 'wiredTiger', 'cache')
  const globalLock = path(status, 'globalLock')
  const residentMemory =
    mbToBytes(path(status, 'mem', 'resident')) ??
    finiteNumber(path(status, 'tcmalloc', 'generic', 'physical_memory_used'))
  const virtualMemory =
    mbToBytes(path(status, 'mem', 'virtual')) ??
    finiteNumber(path(status, 'tcmalloc', 'generic', 'virtual_memory_used'))
  const metrics: MongoMonitoringMetrics = {
    ...emptyMetrics(),
    connectionsCurrent: finiteNumber(path(status, 'connections', 'current')),
    connectionsAvailable: finiteNumber(path(status, 'connections', 'available')),
    connectionsTotalCreated: finiteNumber(path(status, 'connections', 'totalCreated')),
    operationsQueryTotal: finiteNumber(path(status, 'opcounters', 'query')),
    operationsInsertTotal: finiteNumber(path(status, 'opcounters', 'insert')),
    operationsUpdateTotal: finiteNumber(path(status, 'opcounters', 'update')),
    operationsDeleteTotal: finiteNumber(path(status, 'opcounters', 'delete')),
    operationsCommandTotal: finiteNumber(path(status, 'opcounters', 'command')),
    readLatencyMicrosTotal: finiteNumber(path(status, 'opLatencies', 'reads', 'latency')),
    readLatencyOpsTotal: finiteNumber(path(status, 'opLatencies', 'reads', 'ops')),
    writeLatencyMicrosTotal: finiteNumber(path(status, 'opLatencies', 'writes', 'latency')),
    writeLatencyOpsTotal: finiteNumber(path(status, 'opLatencies', 'writes', 'ops')),
    commandLatencyMicrosTotal: finiteNumber(path(status, 'opLatencies', 'commands', 'latency')),
    commandLatencyOpsTotal: finiteNumber(path(status, 'opLatencies', 'commands', 'ops')),
    networkBytesInTotal: finiteNumber(path(status, 'network', 'bytesIn')),
    networkBytesOutTotal: finiteNumber(path(status, 'network', 'bytesOut')),
    networkRequestsTotal: finiteNumber(path(status, 'network', 'numRequests')),
    memoryResidentBytes: residentMemory,
    memoryVirtualBytes: virtualMemory,
    wiredTigerCacheBytes: finiteNumber(path(cache, 'bytes currently in the cache')),
    wiredTigerCacheMaxBytes: finiteNumber(path(cache, 'maximum bytes configured')),
    wiredTigerDirtyBytes: finiteNumber(path(cache, 'tracked dirty bytes in the cache')),
    wiredTigerPagesReadTotal: finiteNumber(path(cache, 'pages read into cache')),
    wiredTigerPagesWrittenTotal: finiteNumber(path(cache, 'pages written from cache')),
    queueReaders: finiteNumber(path(globalLock, 'currentQueue', 'readers')),
    queueWriters: finiteNumber(path(globalLock, 'currentQueue', 'writers')),
    uptimeSeconds: finiteNumber(status.uptime),
  }
  const wiredTigerAvailable = Object.keys(record(status.wiredTiger)).length > 0
  const latencyAvailable = Object.keys(record(status.opLatencies)).length > 0
  const queuesAvailable = Object.keys(record(globalLock)).length > 0

  return {
    metrics,
    capabilities: {
      serverStatus: 'available',
      wiredTiger: wiredTigerAvailable ? 'available' : 'unsupported',
      opLatencies: latencyAvailable ? 'available' : 'unsupported',
      queues: queuesAvailable ? 'available' : 'unsupported',
    },
    process: typeof status.process === 'string' ? status.process : null,
  }
}

function dateMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime()
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN

  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeMongoReplication(status: JsonRecord): {
  lagSeconds: number | null
  members: MongoMonitoringReplicaMember[]
  memberCount: number
  healthyMemberCount: number
} {
  const rawMembers = Array.isArray(status.members) ? status.members.map(record).slice(0, 100) : []
  const primary = rawMembers.find((member) => member.stateStr === 'PRIMARY')
  const primaryTime = dateMillis(primary?.optimeDate)
  const members = rawMembers.map((member) => {
    const memberTime = dateMillis(member.optimeDate)
    const lagSeconds =
      primaryTime !== null && memberTime !== null
        ? Math.max(0, (primaryTime - memberTime) / 1_000)
        : null

    return {
      name: typeof member.name === 'string' ? member.name.slice(0, 512) : 'unknown',
      state: typeof member.stateStr === 'string' ? member.stateStr : 'UNKNOWN',
      health: finiteNumber(member.health),
      self: member.self === true,
      lagSeconds,
    }
  })
  const comparable = members
    .map((member) => member.lagSeconds)
    .filter((value): value is number => value !== null)

  return {
    lagSeconds: comparable.length ? Math.max(...comparable) : null,
    members,
    memberCount: members.length,
    healthyMemberCount: members.filter((member) => member.health === 1).length,
  }
}
