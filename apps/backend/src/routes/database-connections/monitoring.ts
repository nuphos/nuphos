import { Hono } from 'hono'

import { databaseMonitoringHistoryQuerySchema } from '@/lib/api/database-connections'
import { classifyDatabaseError } from '@/lib/database-connections'
import { mongoMonitoringRates, MONGO_MONITOR_RETENTION_MS } from '@/lib/database-monitoring'
import { sampleMongoMonitoringConnection } from '@/lib/database-monitoring-service'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { zv } from '@/lib/validate'
import { databaseMetricSamples } from '@/models'
import { requireConnectionAccess } from '@/routes/database-connections/shared'

import type { DatabaseConnection, DatabaseMetricSample } from '@/models'
import type { ConnectionVariables } from '@/routes/database-connections/shared'

export function monitoringSampleView(
  sample: DatabaseMetricSample,
  previous?: DatabaseMetricSample | null,
) {
  return {
    id: sample._id.toHexString(),
    sampledAt: sample.sampledAt,
    durationMs: sample.durationMs,
    source: sample.source,
    deploymentType: sample.deploymentType,
    process: sample.process,
    node: sample.node,
    replicaSetName: sample.replicaSetName,
    capabilities: sample.capabilities,
    metrics: sample.metrics,
    rates: mongoMonitoringRates(sample, previous),
    replicaMembers: sample.replicaMembers,
  }
}

export function requireMongoMonitoringConnection(
  connection: DatabaseConnection,
  userId: string,
  teamRole: string,
): DatabaseConnection {
  requireConnectionAccess(connection, userId, teamRole)
  if (connection.engine !== 'mongodb') {
    throw new AppError(
      422,
      'database_monitoring_engine_unavailable',
      'Performance monitoring is currently available for MongoDB connections only.',
    )
  }

  return connection
}

export const databaseConnectionMonitoringRoutes = new Hono<{ Variables: ConnectionVariables }>()

databaseConnectionMonitoringRoutes.get(
  '/monitoring',
  zv('query', databaseMonitoringHistoryQuerySchema),
  async (c) => {
    const connection = requireMongoMonitoringConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )
    const { rangeMinutes } = c.req.valid('query')
    const sampledAfter = new Date(Date.now() - rangeMinutes * 60_000)
    const samples = await databaseMetricSamples()
      .find({
        teamId: connection.teamId,
        connectionId: connection._id,
        sampledAt: { $gte: sampledAfter },
      })
      .sort({ sampledAt: 1 })
      .limit(1_000)
      .toArray()

    c.header('Cache-Control', 'no-store')

    return c.json({
      samples: samples.map((sample, index) => monitoringSampleView(sample, samples[index - 1])),
      retentionDays: Math.round(MONGO_MONITOR_RETENTION_MS / (24 * 60 * 60 * 1_000)),
    })
  },
)

databaseConnectionMonitoringRoutes.post('/monitoring/sample', async (c) => {
  const connection = requireMongoMonitoringConnection(
    c.get('databaseConnection'),
    c.get('userId'),
    c.get('teamRole'),
  )

  try {
    const { sample, previous, created } = await sampleMongoMonitoringConnection(connection)

    c.header('Cache-Control', 'no-store')

    return c.json(monitoringSampleView(sample, previous), created ? 201 : 200)
  } catch (error) {
    // Credential-envelope failures describe the backend configuration, not
    // the target database. Preserve their actionable status/code instead of
    // misclassifying them as an unknown database health failure.
    if (error instanceof AppError) throw error
    logError('database.monitoring.sample_failed', error, {
      connection_id: connection._id.toHexString(),
      team_id: connection.teamId.toHexString(),
    })
    const classified = classifyDatabaseError(error)

    throw new AppError(502, `database_${classified.category}_failed`, classified.message)
  }
})
