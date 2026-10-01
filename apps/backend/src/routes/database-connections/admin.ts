import { Hono } from 'hono'

import { databaseConnectionUpdateSchema } from '@/lib/api/database-connections'
import { invalidateMongoCatalogCache } from '@/lib/database-catalog'
import { parseDatabaseConnection } from '@/lib/database-connections'
import { encryptDatabaseCredential } from '@/lib/database-credentials'
import { probeDatabaseConnection } from '@/lib/database-health'
import { assertDatabaseNetworkConfiguration, resolveDatabaseNetwork } from '@/lib/database-network'
import { probeCloudflareD1Connection } from '@/lib/database-provider-cloudflare'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { databaseChangeRequests, databaseConnections, databaseMetricSamples } from '@/models'
import {
  assertHealthyConnection,
  assertSupportedNetworkEngine,
  changeApprovalPolicy,
  connectionNetwork,
  databaseAccess,
  directConnectionUri,
  mapDuplicateName,
  publicView,
  tailscaleSelection,
} from '@/routes/database-connections/shared'

import type { DatabaseConnection } from '@/models'
import type { ConnectionVariables } from '@/routes/database-connections/shared'

export const databaseConnectionAdminRoutes = new Hono<{ Variables: ConnectionVariables }>()

databaseConnectionAdminRoutes.patch(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', databaseConnectionUpdateSchema),
  async (c) => {
    const current = c.get('databaseConnection')
    const input = c.req.valid('json')

    if (
      current.providerOrigin &&
      (input.connectionUri !== undefined ||
        input.engine !== undefined ||
        input.networkMode !== undefined ||
        input.tailscale !== undefined)
    ) {
      throw new AppError(
        422,
        'database_provider_binding_immutable',
        'Provider-managed database bindings cannot be converted into direct connections. Remove the resource and bind it again from the provider.',
      )
    }
    if (
      current.providerOrigin &&
      input.access?.agentPolicy === 'read-only' &&
      !current.providerOrigin.capabilities.query
    ) {
      throw new AppError(
        422,
        'database_provider_query_unsupported',
        'This provider-managed database does not expose read-only Agent queries through the shared gateway.',
      )
    }
    const engine = input.engine ?? current.engine
    const networkMode = input.networkMode ?? current.networkMode
    const tailscale =
      networkMode === 'tailscale'
        ? input.tailscale
          ? tailscaleSelection(input)
          : current.tailscale
        : undefined

    assertDatabaseNetworkConfiguration(networkMode, tailscale)
    assertSupportedNetworkEngine(engine, networkMode)
    const connectivityChanged =
      input.connectionUri !== undefined ||
      input.engine !== undefined ||
      input.networkMode !== undefined ||
      input.tailscale !== undefined
    let parsed = null
    let health = current.health

    if (connectivityChanged) {
      const uri = input.connectionUri ?? directConnectionUri(current)

      try {
        parsed = parseDatabaseConnection(engine, uri)
      } catch (error) {
        throw new AppError(
          400,
          'invalid_database_connection_uri',
          error instanceof Error ? error.message : 'Invalid database connection URI',
        )
      }
      const network = await resolveDatabaseNetwork(current.teamId, networkMode, tailscale)

      health = await probeDatabaseConnection(parsed, undefined, network.mongoOptions)
      assertHealthyConnection(health)
    }
    const now = new Date()
    const currentChangePolicy = changeApprovalPolicy(current)
    const nextChangePolicy = input.changeApprovalPolicy
      ? {
          minimumApprovals: input.changeApprovalPolicy.minimumApprovals,
          version: currentChangePolicy.version + 1,
          updatedAt: now,
          updatedBy: c.get('userId'),
        }
      : currentChangePolicy
    const next: DatabaseConnection = {
      ...current,
      name: input.name ?? current.name,
      engine,
      environment: input.environment ?? current.environment,
      tags: input.tags ? [...new Set(input.tags)] : current.tags,
      endpoint: parsed?.endpoint ?? current.endpoint,
      databaseName: parsed ? (health.databaseName ?? parsed.databaseName) : current.databaseName,
      tls: parsed?.tls ?? current.tls,
      networkMode,
      tailscale,
      encryptedCredential:
        input.connectionUri && parsed
          ? encryptDatabaseCredential(parsed.connectionUri)
          : current.encryptedCredential,
      access: input.access ? databaseAccess(input.access, c.get('userId'), now) : current.access,
      changeApprovalPolicy: nextChangePolicy,
      relations: input.relations ?? current.relations,
      health,
      updatedAt: now,
      updatedBy: c.get('userId'),
    }
    const result = await databaseConnections()
      .replaceOne({ _id: current._id, teamId: current.teamId }, next)
      .catch(mapDuplicateName)

    if (result.matchedCount === 0)
      throw new AppError(404, 'database_connection_not_found', 'Database connection not found.')
    if (input.changeApprovalPolicy) {
      await databaseChangeRequests().updateMany(
        {
          teamId: current.teamId,
          connectionId: current._id,
          status: { $in: ['pending_approval', 'approved'] },
        },
        {
          $set: {
            status: 'pending_approval',
            approvals: [],
            policySnapshot: nextChangePolicy,
            updatedAt: now,
          },
          $push: {
            events: {
              type: 'policy_invalidated',
              actorUserId: c.get('userId'),
              at: now,
              comment: 'Approval policy changed; prior approvals were invalidated.',
            },
          },
        },
      )
    }
    invalidateMongoCatalogCache(current._id.toHexString())
    c.header('Cache-Control', 'no-store')

    return c.json(publicView(next, c.get('userId'), c.get('teamRole')))
  },
)

databaseConnectionAdminRoutes.post('/test', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const connection = c.get('databaseConnection')

  if (connection.engine === 'cloudflare-d1') {
    const { database, health } = await probeCloudflareD1Connection(connection)
    const now = new Date()

    await databaseConnections().updateOne(
      { _id: connection._id, teamId: connection.teamId },
      {
        $set: { health, databaseName: database.name, updatedAt: now, updatedBy: c.get('userId') },
      },
    )
    const next = {
      ...connection,
      health,
      databaseName: database.name,
      updatedAt: now,
      updatedBy: c.get('userId'),
    }

    c.header('Cache-Control', 'no-store')

    return c.json(publicView(next, c.get('userId'), c.get('teamRole')))
  }
  const parsed = parseDatabaseConnection(connection.engine, directConnectionUri(connection))
  const network = await connectionNetwork(connection)
  const health = await probeDatabaseConnection(parsed, undefined, network.mongoOptions)
  const now = new Date()

  await databaseConnections().updateOne(
    { _id: connection._id, teamId: connection.teamId },
    {
      $set: {
        health,
        databaseName: health.databaseName ?? parsed.databaseName,
        updatedAt: now,
        updatedBy: c.get('userId'),
      },
    },
  )
  const next = {
    ...connection,
    health,
    databaseName: health.databaseName ?? parsed.databaseName,
    updatedAt: now,
    updatedBy: c.get('userId'),
  }

  c.header('Cache-Control', 'no-store')

  return c.json(publicView(next, c.get('userId'), c.get('teamRole')))
})

databaseConnectionAdminRoutes.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const connection = c.get('databaseConnection')

  await Promise.all([
    databaseMetricSamples().deleteMany({
      teamId: connection.teamId,
      connectionId: connection._id,
    }),
    databaseChangeRequests().deleteMany({
      teamId: connection.teamId,
      connectionId: connection._id,
    }),
  ])
  const result = await databaseConnections().deleteOne({
    _id: connection._id,
    teamId: connection.teamId,
  })

  if (result.deletedCount === 0)
    throw new AppError(404, 'database_connection_not_found', 'Database connection not found.')
  invalidateMongoCatalogCache(connection._id.toHexString())

  return c.json({ ok: true })
})
