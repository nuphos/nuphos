import { z } from 'zod'

import { objectIdSchema } from './shared'

const monitoringCapabilitySchema = z.enum([
  'available',
  'unsupported',
  'permission-denied',
  'error',
])
const monitoringNullableNumberSchema = z.number().finite().nullable()
const databaseMonitoringMetricsSchema = z.object({
  connectionsCurrent: monitoringNullableNumberSchema,
  connectionsAvailable: monitoringNullableNumberSchema,
  connectionsTotalCreated: monitoringNullableNumberSchema,
  operationsQueryTotal: monitoringNullableNumberSchema,
  operationsInsertTotal: monitoringNullableNumberSchema,
  operationsUpdateTotal: monitoringNullableNumberSchema,
  operationsDeleteTotal: monitoringNullableNumberSchema,
  operationsCommandTotal: monitoringNullableNumberSchema,
  readLatencyMicrosTotal: monitoringNullableNumberSchema,
  readLatencyOpsTotal: monitoringNullableNumberSchema,
  writeLatencyMicrosTotal: monitoringNullableNumberSchema,
  writeLatencyOpsTotal: monitoringNullableNumberSchema,
  commandLatencyMicrosTotal: monitoringNullableNumberSchema,
  commandLatencyOpsTotal: monitoringNullableNumberSchema,
  networkBytesInTotal: monitoringNullableNumberSchema,
  networkBytesOutTotal: monitoringNullableNumberSchema,
  networkRequestsTotal: monitoringNullableNumberSchema,
  memoryResidentBytes: monitoringNullableNumberSchema,
  memoryVirtualBytes: monitoringNullableNumberSchema,
  wiredTigerCacheBytes: monitoringNullableNumberSchema,
  wiredTigerCacheMaxBytes: monitoringNullableNumberSchema,
  wiredTigerDirtyBytes: monitoringNullableNumberSchema,
  wiredTigerPagesReadTotal: monitoringNullableNumberSchema,
  wiredTigerPagesWrittenTotal: monitoringNullableNumberSchema,
  queueReaders: monitoringNullableNumberSchema,
  queueWriters: monitoringNullableNumberSchema,
  replicationLagSeconds: monitoringNullableNumberSchema,
  replicationMembers: monitoringNullableNumberSchema,
  replicationHealthyMembers: monitoringNullableNumberSchema,
  uptimeSeconds: monitoringNullableNumberSchema,
})
const databaseMonitoringRatesSchema = z.object({
  queryPerSecond: monitoringNullableNumberSchema,
  insertPerSecond: monitoringNullableNumberSchema,
  updatePerSecond: monitoringNullableNumberSchema,
  deletePerSecond: monitoringNullableNumberSchema,
  commandPerSecond: monitoringNullableNumberSchema,
  bytesInPerSecond: monitoringNullableNumberSchema,
  bytesOutPerSecond: monitoringNullableNumberSchema,
  readLatencyMicros: monitoringNullableNumberSchema,
  writeLatencyMicros: monitoringNullableNumberSchema,
  commandLatencyMicros: monitoringNullableNumberSchema,
})

export const databaseMonitoringSampleSchema = z.object({
  id: objectIdSchema,
  sampledAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  source: z.literal('mongodb-direct'),
  deploymentType: z.enum(['standalone', 'replica-set', 'sharded', 'unknown']),
  process: z.string().nullable(),
  node: z.string().nullable(),
  replicaSetName: z.string().nullable(),
  capabilities: z.object({
    serverStatus: monitoringCapabilitySchema,
    wiredTiger: monitoringCapabilitySchema,
    opLatencies: monitoringCapabilitySchema,
    queues: monitoringCapabilitySchema,
    replication: monitoringCapabilitySchema,
  }),
  metrics: databaseMonitoringMetricsSchema,
  rates: databaseMonitoringRatesSchema,
  replicaMembers: z.array(
    z.object({
      name: z.string(),
      state: z.string(),
      health: monitoringNullableNumberSchema,
      self: z.boolean(),
      lagSeconds: monitoringNullableNumberSchema,
    }),
  ),
})
