import { ObjectId } from 'mongodb'

import { decryptDatabaseCredential } from '@/lib/database-credentials'
import {
  collectMongoMonitoringSnapshot,
  MONGO_MONITOR_MIN_SAMPLE_INTERVAL_MS,
  MONGO_MONITOR_RETENTION_MS,
} from '@/lib/database-monitoring'
import { resolveDatabaseNetwork } from '@/lib/database-network'
import { AppError } from '@/lib/errors'
import { databaseMetricSamples } from '@/models'

import type { DatabaseConnection, DatabaseMetricSample } from '@/models'

export type MongoMonitoringSampleResult = {
  sample: DatabaseMetricSample
  previous: DatabaseMetricSample | null
  created: boolean
}

/**
 * The shared MongoDB sampler used by both the Monitoring UI and scheduled
 * alert evaluation. It persists normalized numeric metrics only; the raw
 * serverStatus response and credential never leave this backend operation.
 */
export async function sampleMongoMonitoringConnection(
  connection: DatabaseConnection,
): Promise<MongoMonitoringSampleResult> {
  if (connection.engine !== 'mongodb') {
    throw new AppError(
      422,
      'database_monitoring_engine_unavailable',
      'Performance monitoring is currently available for MongoDB connections only.',
    )
  }
  if (!connection.encryptedCredential) {
    throw new AppError(
      422,
      'database_provider_operation_unavailable',
      'This database connection has no direct credential for monitoring.',
    )
  }
  const recent = await databaseMetricSamples()
    .find({
      teamId: connection.teamId,
      connectionId: connection._id,
    })
    .sort({ sampledAt: -1 })
    .limit(2)
    .toArray()

  if (
    recent[0] &&
    Date.now() - recent[0].sampledAt.getTime() < MONGO_MONITOR_MIN_SAMPLE_INTERVAL_MS
  ) {
    return { sample: recent[0], previous: recent[1] ?? null, created: false }
  }

  const network = await resolveDatabaseNetwork(
    connection.teamId,
    connection.networkMode,
    connection.tailscale,
  )
  const snapshot = await collectMongoMonitoringSnapshot(
    decryptDatabaseCredential(connection.encryptedCredential),
    undefined,
    network.mongoOptions,
  )
  const sample: DatabaseMetricSample = {
    _id: new ObjectId(),
    teamId: connection.teamId,
    connectionId: connection._id,
    ...snapshot,
    expiresAt: new Date(snapshot.sampledAt.getTime() + MONGO_MONITOR_RETENTION_MS),
  }

  await databaseMetricSamples().insertOne(sample)

  return { sample, previous: recent[0] ?? null, created: true }
}
