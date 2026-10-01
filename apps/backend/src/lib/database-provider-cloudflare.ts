import { ObjectId } from 'mongodb'

import { findCloudflareAccount } from '@/lib/byos/account'
import { cloudflareAccountHandle } from '@/lib/byos/cloudflare-account-handle'
import { getD1Database } from '@/lib/byos/cloudflare-d1'
import { AppError } from '@/lib/errors'
import { databaseConnections } from '@/models'

import type { CloudflareD1Database } from '@/lib/byos/cloudflare-d1'
import type {
  CloudflareAccountBinding,
  DatabaseConnection,
  DatabaseConnectionHealth,
  DatabaseProviderOrigin,
} from '@/models'

const D1_CAPABILITIES: DatabaseProviderOrigin['capabilities'] = {
  catalog: true,
  query: false,
  monitoring: false,
  changes: false,
  backupRestore: false,
  parameters: false,
}

function originFilter(teamId: ObjectId, externalResourceId: string) {
  return {
    teamId,
    'providerOrigin.provider': 'cloudflare' as const,
    'providerOrigin.product': 'd1' as const,
    'providerOrigin.externalResourceId': externalResourceId,
  }
}

function providerOrigin(
  binding: CloudflareAccountBinding,
  database: CloudflareD1Database,
): DatabaseProviderOrigin {
  return {
    provider: 'cloudflare',
    product: 'd1',
    integrationId: binding.id,
    externalResourceId: database.uuid,
    accountId: binding.accountId,
    accountName: binding.accountName,
    region: database.runningInRegion,
    capabilities: D1_CAPABILITIES,
  }
}

function healthFor(database: CloudflareD1Database, latencyMs: number): DatabaseConnectionHealth {
  return {
    status: 'healthy',
    errorCategory: null,
    message: null,
    checkedAt: new Date(),
    latencyMs,
    databaseName: database.name,
    serverVersion: database.version,
    // The connector binding may have write permissions. Read-only behavior in
    // the shared workspace is enforced by its dedicated gateway, not claimed
    // as a property of the upstream credential.
    readOnly: 'writable',
  }
}

function candidateName(databaseName: string, attempt: number): string {
  if (attempt === 0) return databaseName
  if (attempt === 1) return `${databaseName} · Cloudflare D1`.slice(0, 100)

  return `${databaseName.slice(0, 80)} · Cloudflare D1 ${String(attempt)}`.slice(0, 100)
}

/**
 * Materialize a provider-owned D1 database as a lightweight Nuphos database
 * resource. The connector binding is referenced, never copied. Reopening the
 * same provider resource is idempotent and explicitly rebinds it to the active
 * Cloudflare integration after a connector rotation.
 */
export async function materializeCloudflareD1Connection(input: {
  teamId: ObjectId
  binding: CloudflareAccountBinding
  database: CloudflareD1Database
  userId: string
  latencyMs: number
}): Promise<DatabaseConnection> {
  const filter = originFilter(input.teamId, input.database.uuid)
  const existing = await databaseConnections().findOne(filter)
  const now = new Date()
  const origin = providerOrigin(input.binding, input.database)
  const health = healthFor(input.database, input.latencyMs)

  if (existing) {
    await databaseConnections().updateOne(
      { _id: existing._id, teamId: input.teamId },
      {
        $set: {
          endpoint: `cloudflare://${input.binding.accountId}/d1/${input.database.uuid}`,
          databaseName: input.database.name,
          providerOrigin: origin,
          health,
          updatedAt: now,
          updatedBy: input.userId,
        },
      },
    )

    return {
      ...existing,
      endpoint: `cloudflare://${input.binding.accountId}/d1/${input.database.uuid}`,
      databaseName: input.database.name,
      providerOrigin: origin,
      health,
      updatedAt: now,
      updatedBy: input.userId,
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const connection: DatabaseConnection = {
      _id: new ObjectId(),
      teamId: input.teamId,
      name: candidateName(input.database.name, attempt),
      engine: 'cloudflare-d1',
      environment: 'provider-managed',
      tags: ['cloudflare', 'd1', 'provider-managed'],
      endpoint: `cloudflare://${input.binding.accountId}/d1/${input.database.uuid}`,
      databaseName: input.database.name,
      tls: { enabled: true, mode: 'provider-managed' },
      networkMode: 'public',
      providerOrigin: origin,
      access: {
        memberAllowList: ['*'],
        agentPolicy: 'metadata-only',
        updatedAt: now,
        updatedBy: input.userId,
      },
      changeApprovalPolicy: {
        minimumApprovals: 1,
        version: 1,
        updatedAt: now,
        updatedBy: input.userId,
      },
      relations: [],
      health,
      createdAt: now,
      createdBy: input.userId,
      updatedAt: now,
      updatedBy: input.userId,
    }

    try {
      await databaseConnections().insertOne(connection)

      return connection
    } catch (error) {
      const concurrent = await databaseConnections().findOne(filter)

      if (concurrent) return concurrent
      if (!(error instanceof Error) || !/duplicate key/i.test(error.message)) throw error
    }
  }

  throw new Error('Could not allocate a unique Nuphos name for the Cloudflare D1 database')
}

export async function probeCloudflareD1Connection(
  connection: DatabaseConnection,
): Promise<{ database: CloudflareD1Database; health: DatabaseConnectionHealth }> {
  const { origin, handle } = await resolveCloudflareD1Connection(connection)
  const startedAt = Date.now()
  const database = await getD1Database(handle, origin.externalResourceId)

  return { database, health: healthFor(database, Date.now() - startedAt) }
}

export async function resolveCloudflareD1Connection(connection: DatabaseConnection) {
  const origin = connection.providerOrigin

  if (!origin || origin.provider !== 'cloudflare' || origin.product !== 'd1') {
    throw new AppError(
      422,
      'database_provider_origin_missing',
      'Cloudflare D1 provider metadata is missing.',
    )
  }
  const binding = await findCloudflareAccount(connection.teamId, origin.accountId)

  if (!binding?.id.equals(origin.integrationId)) {
    throw new AppError(
      403,
      'database_provider_binding_revoked',
      'The Cloudflare binding used by this database resource was removed or replaced. Open the D1 database from the active Cloudflare connector to re-bind it.',
    )
  }

  return {
    origin,
    binding,
    handle: await cloudflareAccountHandle(connection.teamId, binding),
  }
}
