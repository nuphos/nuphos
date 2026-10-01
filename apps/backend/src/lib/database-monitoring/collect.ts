import { databaseMongoClient } from '@/lib/database-mongo-client'
import {
  capabilityError,
  emptyMetrics,
  normalizeMongoReplication,
  normalizeMongoServerStatus,
} from '@/lib/database-monitoring/normalize'
import { MONGO_MONITOR_TIMEOUT_MS } from '@/lib/database-monitoring/types'

import type { MongoNetworkOptions } from '@/lib/database-mongo-client'
import type {
  JsonRecord,
  MongoDeploymentType,
  MongoMonitoringReplicaMember,
  MongoMonitoringSnapshot,
  MonitoringCapabilityState,
} from '@/lib/database-monitoring/types'

export async function collectMongoMonitoringSnapshot(
  connectionUri: string,
  timeoutMs = MONGO_MONITOR_TIMEOUT_MS,
  network: MongoNetworkOptions = {},
): Promise<MongoMonitoringSnapshot> {
  const startedAt = Date.now()
  const client = databaseMongoClient(
    connectionUri,
    {
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
      socketTimeoutMS: timeoutMs,
      maxPoolSize: 1,
      minPoolSize: 0,
    },
    network,
  )

  try {
    await client.connect()
    const admin = client.db('admin')
    const hello = (await admin.command({ hello: 1 }, { timeoutMS: timeoutMs })) as JsonRecord
    const deploymentType: MongoDeploymentType =
      hello.msg === 'isdbgrid'
        ? 'sharded'
        : typeof hello.setName === 'string'
          ? 'replica-set'
          : 'standalone'
    const node =
      typeof hello.me === 'string'
        ? hello.me.slice(0, 512)
        : typeof hello.primary === 'string'
          ? hello.primary.slice(0, 512)
          : null
    let metrics = emptyMetrics()
    let process: string | null = null
    // No initializer: both arms of the try/catch below assign all four, so an
    // 'error' seed here is dead and would mask a future path that forgets one —
    // TypeScript's definite-assignment check catches that, a default cannot.
    let serverStatusState: MonitoringCapabilityState
    let wiredTigerState: MonitoringCapabilityState
    let opLatenciesState: MonitoringCapabilityState
    let queuesState: MonitoringCapabilityState

    try {
      const normalized = normalizeMongoServerStatus(
        (await admin.command(
          { serverStatus: 1, metrics: 0, locks: 0 },
          { timeoutMS: timeoutMs },
        )) as JsonRecord,
      )

      metrics = normalized.metrics
      process = normalized.process
      serverStatusState = normalized.capabilities.serverStatus
      wiredTigerState = normalized.capabilities.wiredTiger
      opLatenciesState = normalized.capabilities.opLatencies
      queuesState = normalized.capabilities.queues
    } catch (error) {
      serverStatusState = capabilityError(error)
      wiredTigerState = serverStatusState
      opLatenciesState = serverStatusState
      queuesState = serverStatusState
    }

    let replicationState: MonitoringCapabilityState =
      deploymentType === 'replica-set' ? 'error' : 'unsupported'
    let replicaMembers: MongoMonitoringReplicaMember[] = []

    if (deploymentType === 'replica-set') {
      try {
        const replication = normalizeMongoReplication(
          (await admin.command({ replSetGetStatus: 1 }, { timeoutMS: timeoutMs })) as JsonRecord,
        )

        metrics.replicationLagSeconds = replication.lagSeconds
        metrics.replicationMembers = replication.memberCount
        metrics.replicationHealthyMembers = replication.healthyMemberCount
        replicaMembers = replication.members
        replicationState = 'available'
      } catch (error) {
        replicationState = capabilityError(error)
      }
    }

    return {
      sampledAt: new Date(),
      durationMs: Date.now() - startedAt,
      source: 'mongodb-direct',
      deploymentType,
      process,
      node,
      replicaSetName: typeof hello.setName === 'string' ? hello.setName.slice(0, 256) : null,
      capabilities: {
        serverStatus: serverStatusState,
        wiredTiger: wiredTigerState,
        opLatencies: opLatenciesState,
        queues: queuesState,
        replication: replicationState,
      },
      metrics,
      replicaMembers,
    }
  } finally {
    await client.close().catch(() => undefined)
  }
}
