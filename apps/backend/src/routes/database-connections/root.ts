import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import {
  databaseConnectionCreateSchema,
  databaseConnectionTestSchema,
} from '@/lib/api/database-connections'
import { parseDatabaseConnection } from '@/lib/database-connections'
import { encryptDatabaseCredential } from '@/lib/database-credentials'
import { probeDatabaseConnection } from '@/lib/database-health'
import { assertDatabaseNetworkConfiguration, resolveDatabaseNetwork } from '@/lib/database-network'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { databaseConnections } from '@/models'
import {
  assertHealthyConnection,
  assertSupportedNetworkEngine,
  canUseConnection,
  conversationDatabaseAllowed,
  databaseAccess,
  mapDuplicateName,
  publicView,
  tailscaleSelection,
} from '@/routes/database-connections/shared'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { DatabaseConnection } from '@/models'

export const databaseConnectionRootRoutes = new Hono<{ Variables: TeamAuthVariables }>()

databaseConnectionRootRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const all = await databaseConnections().find({ teamId }).sort({ updatedAt: -1 }).toArray()
  const visible = all
    .filter((connection) => canUseConnection(connection, c.get('userId'), c.get('teamRole')))
    .filter((connection) => conversationDatabaseAllowed(c, connection, 'metadata'))

  c.header('Cache-Control', 'no-store')

  return c.json({
    connections: visible.map((connection) =>
      publicView(connection, c.get('userId'), c.get('teamRole')),
    ),
  })
})

databaseConnectionRootRoutes.post(
  '/test',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', databaseConnectionTestSchema),
  async (c) => {
    const input = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const tailscale = tailscaleSelection(input)

    assertDatabaseNetworkConfiguration(input.networkMode, tailscale)
    assertSupportedNetworkEngine(input.engine, input.networkMode)
    let parsed

    try {
      parsed = parseDatabaseConnection(input.engine, input.connectionUri)
    } catch (error) {
      throw new AppError(
        400,
        'invalid_database_connection_uri',
        error instanceof Error ? error.message : 'Invalid database connection URI',
      )
    }
    const network = await resolveDatabaseNetwork(teamId, input.networkMode, tailscale)
    const health = await probeDatabaseConnection(parsed, undefined, network.mongoOptions)

    c.header('Cache-Control', 'no-store')

    return c.json({
      endpoint: parsed.endpoint,
      databaseName: parsed.databaseName,
      tls: parsed.tls,
      health,
    })
  },
)

databaseConnectionRootRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', databaseConnectionCreateSchema),
  async (c) => {
    const input = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const tailscale = tailscaleSelection(input)

    assertDatabaseNetworkConfiguration(input.networkMode, tailscale)
    assertSupportedNetworkEngine(input.engine, input.networkMode)
    let parsed

    try {
      parsed = parseDatabaseConnection(input.engine, input.connectionUri)
    } catch (error) {
      throw new AppError(
        400,
        'invalid_database_connection_uri',
        error instanceof Error ? error.message : 'Invalid database connection URI',
      )
    }
    const network = await resolveDatabaseNetwork(teamId, input.networkMode, tailscale)
    const health = await probeDatabaseConnection(parsed, undefined, network.mongoOptions)

    assertHealthyConnection(health)
    const now = new Date()
    const connection: DatabaseConnection = {
      _id: new ObjectId(),
      teamId,
      name: input.name,
      engine: input.engine,
      environment: input.environment,
      tags: [...new Set(input.tags)],
      endpoint: parsed.endpoint,
      databaseName: health.databaseName ?? parsed.databaseName,
      tls: parsed.tls,
      networkMode: input.networkMode,
      tailscale,
      encryptedCredential: encryptDatabaseCredential(parsed.connectionUri),
      // A database connection is always created as a team resource. Member
      // visibility may be narrowed later by an administrator, but creation no
      // longer exposes or honors a personal-resource mode.
      access: databaseAccess({ ...input.access, memberAllowList: ['*'] }, c.get('userId'), now),
      changeApprovalPolicy: {
        minimumApprovals: 1,
        version: 1,
        updatedAt: now,
        updatedBy: c.get('userId'),
      },
      relations: input.relations,
      health,
      createdAt: now,
      createdBy: c.get('userId'),
      updatedAt: now,
      updatedBy: c.get('userId'),
    }

    await databaseConnections().insertOne(connection).catch(mapDuplicateName)
    c.header('Cache-Control', 'no-store')

    return c.json(publicView(connection, c.get('userId'), c.get('teamRole')), 201)
  },
)
