import { MongoServerError } from 'mongodb'

import { accessView, normalizeAccessInput } from '@/lib/byos/access'
import {
  canAccessDatabaseConnection,
  databaseAgentPolicyAllows,
  databaseConnectionHealthIsStorable,
} from '@/lib/database-connections'
import { decryptDatabaseCredential } from '@/lib/database-credentials'
import { resolveDatabaseNetwork } from '@/lib/database-network'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { databaseConnections } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type {
  DatabaseChangeApprovalPolicy,
  DatabaseConnection,
  DatabaseConnectionAccess,
  DatabaseConnectionHealth,
} from '@/models'
import type { MiddlewareHandler } from 'hono'

export type ConnectionVariables = TeamAuthVariables & { databaseConnection: DatabaseConnection }

export function databaseAccess(
  input: { memberAllowList: string[]; agentPolicy: DatabaseConnectionAccess['agentPolicy'] },
  userId: string,
  now = new Date(),
): DatabaseConnectionAccess {
  return { ...normalizeAccessInput(input, userId, now), agentPolicy: input.agentPolicy }
}

export function canUseConnection(
  connection: DatabaseConnection,
  userId: string,
  teamRole: string,
): boolean {
  return canAccessDatabaseConnection(connection.access, userId, teamRole)
}

type ConversationDatabaseContext = {
  get(key: 'conversationAgent'): { sessionId: string } | undefined
}

export function conversationDatabaseAllowed(
  c: unknown,
  connection: DatabaseConnection,
  operation: 'metadata' | 'query',
): boolean {
  const agent = (c as ConversationDatabaseContext).get('conversationAgent')

  if (!agent) return true

  return (
    connection.engine === 'mongodb' &&
    databaseAgentPolicyAllows(connection.access.agentPolicy, operation)
  )
}

export function requireConversationDatabasePolicy(
  c: unknown,
  connection: DatabaseConnection,
  operation: 'metadata' | 'query',
): void {
  if (conversationDatabaseAllowed(c, connection, operation)) return

  throw new AppError(
    403,
    'database_agent_policy_denied',
    operation === 'query'
      ? 'Agent read-only queries are disabled for this database connection.'
      : 'Agent discovery is disabled for this database connection.',
  )
}

export function conversationDatabaseSessionId(c: unknown): string | null {
  return (c as ConversationDatabaseContext).get('conversationAgent')?.sessionId ?? null
}

export function publicView(connection: DatabaseConnection, userId: string, teamRole: string) {
  const admin = teamRole === 'ADMINISTRATOR'

  return {
    id: connection._id.toHexString(),
    name: connection.name,
    engine: connection.engine,
    environment: connection.environment,
    tags: connection.tags,
    endpoint: connection.endpoint,
    databaseName: connection.databaseName,
    tls: connection.tls,
    networkMode: connection.networkMode,
    tailscale: connection.tailscale
      ? { bindingId: connection.tailscale.bindingId.toHexString(), tag: connection.tailscale.tag }
      : undefined,
    providerOrigin: connection.providerOrigin
      ? {
          ...connection.providerOrigin,
          integrationId: connection.providerOrigin.integrationId.toHexString(),
        }
      : undefined,
    agentPolicy: connection.access.agentPolicy,
    relations: connection.relations,
    health: connection.health,
    canUse: canUseConnection(connection, userId, teamRole),
    ...(admin
      ? { access: { ...accessView(connection.access), agentPolicy: connection.access.agentPolicy } }
      : {}),
    changeApprovalPolicy: changeApprovalPolicy(connection),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  }
}

export function changeApprovalPolicy(connection: DatabaseConnection): DatabaseChangeApprovalPolicy {
  return (
    connection.changeApprovalPolicy ?? {
      minimumApprovals: 1,
      version: 1,
      updatedAt: connection.createdAt,
      updatedBy: connection.createdBy,
    }
  )
}

export function assertSupportedNetworkEngine(
  engine: DatabaseConnection['engine'],
  networkMode: DatabaseConnection['networkMode'],
): void {
  if (networkMode === 'tailscale' && engine !== 'mongodb') {
    throw new AppError(
      422,
      'database_tailscale_engine_unavailable',
      'Tailscale database connectivity is currently available for MongoDB connections only.',
    )
  }
}

export function tailscaleSelection(input: { tailscale?: { bindingId: string; tag: string } }) {
  return input.tailscale
    ? {
        bindingId: parseObjectId(input.tailscale.bindingId, 'tailscale.bindingId'),
        tag: input.tailscale.tag,
      }
    : undefined
}

export async function connectionNetwork(connection: DatabaseConnection) {
  assertSupportedNetworkEngine(connection.engine, connection.networkMode)

  return resolveDatabaseNetwork(connection.teamId, connection.networkMode, connection.tailscale)
}

export function assertHealthyConnection(health: DatabaseConnectionHealth): void {
  if (!databaseConnectionHealthIsStorable(health)) {
    throw new AppError(
      422,
      `database_${health.errorCategory ?? 'health_check'}_failed`,
      health.message ?? 'Database health check failed.',
    )
  }
  // Credential capability and Nuphos authorization are separate boundaries.
  // A write-capable account may be stored, but the current Agent policies only
  // expose metadata or the read-only query gateway. Credentials never enter a
  // model context or sandbox, so write access cannot be obtained by bypassing
  // the selected policy in the renderer.
}

export function mapDuplicateName(error: unknown): never {
  if (error instanceof MongoServerError && error.code === 11000) {
    throw new AppError(
      409,
      'database_connection_name_conflict',
      'A database connection with this name already exists in the team.',
    )
  }
  throw error
}

export const requireDatabaseConnection =
  (): MiddlewareHandler<{ Variables: ConnectionVariables }> => async (c, next) => {
    const connectionIdParam = c.req.param('connectionId')

    if (!connectionIdParam)
      throw new AppError(400, 'invalid_request', 'Missing connectionId param.')
    const connectionId = parseObjectId(connectionIdParam, 'connectionId')
    const connection = await databaseConnections().findOne({
      _id: connectionId,
      teamId: parseObjectId(c.get('teamId'), 'teamId'),
    })

    // DELETE is intentionally idempotent. If the backend completed the removal
    // but the client timed out before receiving the response, retrying must not
    // turn a successful destructive operation into a misleading 404 failure.
    if (!connection && c.req.method === 'DELETE') return c.json({ ok: true })
    if (!connection)
      throw new AppError(404, 'database_connection_not_found', 'Database connection not found.')
    c.set('databaseConnection', connection)
    await next()
  }

export function requireConnectionAccess(
  connection: DatabaseConnection,
  userId: string,
  teamRole: string,
): DatabaseConnection {
  if (!canUseConnection(connection, userId, teamRole)) {
    throw new AppError(
      403,
      'database_connection_access_denied',
      'You are not allowed to access this database connection.',
    )
  }

  return connection
}

export function directConnectionUri(connection: DatabaseConnection): string {
  if (!connection.encryptedCredential) {
    throw new AppError(
      422,
      'database_provider_operation_unavailable',
      'This provider-managed database operation must be handled through its active connector binding.',
    )
  }

  return decryptDatabaseCredential(connection.encryptedCredential)
}

export function requireMongoCatalogConnection(
  connection: DatabaseConnection,
  userId: string,
  teamRole: string,
): DatabaseConnection {
  requireConnectionAccess(connection, userId, teamRole)
  if (connection.engine !== 'mongodb') {
    throw new AppError(
      422,
      'database_catalog_engine_unavailable',
      'Schema inventory is currently available for MongoDB connections only.',
    )
  }

  return connection
}
