import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import {
  databaseMongoReadQuerySchema,
  databaseQueryAuditListSchema,
} from '@/lib/api/database-connections'
import { classifyDatabaseError } from '@/lib/database-connections'
import { mongoAuditStatement, mongoQueryShape, runMongoReadQuery } from '@/lib/database-query'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { databaseQueryAudits } from '@/models'
import {
  connectionNetwork,
  conversationDatabaseSessionId,
  directConnectionUri,
  requireConnectionAccess,
  requireConversationDatabasePolicy,
  requireMongoCatalogConnection,
} from '@/routes/database-connections/shared'

import type { MongoReadQuery } from '@/lib/database-query'
import type { ConnectionVariables } from '@/routes/database-connections/shared'

export const databaseConnectionQueryRoutes = new Hono<{ Variables: ConnectionVariables }>()

databaseConnectionQueryRoutes.post(
  '/query/mongodb',
  zv('json', databaseMongoReadQuerySchema),
  async (c) => {
    const connection = requireMongoCatalogConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    requireConversationDatabasePolicy(c, connection, 'query')
    const input = c.req.valid('json') as MongoReadQuery
    const auditId = new ObjectId()
    const startedAt = Date.now()
    const conversationSessionId = conversationDatabaseSessionId(c)
    const sessionHeader = c.req.header('x-nuphos-session-id')?.trim()
    const auditStatement = mongoAuditStatement(input)

    await databaseQueryAudits().insertOne({
      _id: auditId,
      teamId: connection.teamId,
      connectionId: connection._id,
      userId: c.get('userId'),
      sessionId:
        conversationSessionId ??
        (sessionHeader && sessionHeader.length <= 256 ? sessionHeader : null),
      source: conversationSessionId ? 'agent' : 'human',
      networkMode: connection.networkMode,
      executionPlane: connection.networkMode === 'tailscale' ? 'tailscale-tsnet' : 'backend',
      networkBindingId: connection.tailscale?.bindingId ?? null,
      networkTag: connection.tailscale?.tag ?? null,
      operation: input.operation,
      database: input.database,
      collection: input.collection,
      queryShape: mongoQueryShape(input),
      queryStatement: auditStatement.statement,
      queryStatementTruncated: auditStatement.truncated,
      queryRedactedFields: auditStatement.redactedFields,
      queryInput: auditStatement.queryInput ?? undefined,
      outcome: 'running',
      durationMs: null,
      rowCount: null,
      truncated: null,
      errorCategory: null,
      createdAt: new Date(),
      completedAt: null,
    })
    try {
      const network = await connectionNetwork(connection)
      const result = await runMongoReadQuery(
        directConnectionUri(connection),
        input,
        network.mongoOptions,
      )

      await databaseQueryAudits().updateOne(
        { _id: auditId },
        {
          $set: {
            outcome: 'succeeded',
            durationMs: result.durationMs,
            rowCount: result.rowCount,
            truncated: result.truncated,
            completedAt: new Date(),
          },
        },
      )
      c.header('Cache-Control', 'no-store')

      return c.json(result)
    } catch (error) {
      const rejected =
        error instanceof Error && /not allowed|read-only gateway/i.test(error.message)
      const classified = classifyDatabaseError(error)

      await databaseQueryAudits().updateOne(
        { _id: auditId },
        {
          $set: {
            outcome: rejected ? 'rejected' : 'failed',
            durationMs: Date.now() - startedAt,
            errorCategory: rejected ? 'authorization' : classified.category,
            completedAt: new Date(),
          },
        },
      )
      if (rejected)
        throw new AppError(
          422,
          'database_query_rejected',
          'The query contains an operation that is not allowed by the read-only gateway.',
        )
      throw new AppError(502, `database_${classified.category}_failed`, classified.message)
    }
  },
)

databaseConnectionQueryRoutes.get(
  '/query/audit',
  zv('query', databaseQueryAuditListSchema),
  async (c) => {
    const connection = requireConnectionAccess(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    requireConversationDatabasePolicy(c, connection, 'metadata')
    const { limit } = c.req.valid('query')
    const events = await databaseQueryAudits()
      .find({
        teamId: connection.teamId,
        connectionId: connection._id,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    c.header('Cache-Control', 'no-store')

    return c.json({
      events: events.map((event) => ({
        id: event._id.toHexString(),
        userId: event.userId,
        sessionId: event.sessionId,
        source: event.source,
        networkMode: event.networkMode ?? 'public',
        executionPlane: event.executionPlane ?? 'backend',
        networkBindingId: event.networkBindingId?.toHexString() ?? null,
        networkTag: event.networkTag ?? null,
        operation: event.operation,
        database: event.database,
        collection: event.collection,
        queryShape: event.queryShape,
        queryStatement: event.queryStatement ?? null,
        queryStatementTruncated: event.queryStatementTruncated ?? false,
        queryRedactedFields: event.queryRedactedFields ?? [],
        queryInput: event.queryInput ?? null,
        outcome: event.outcome,
        durationMs: event.durationMs,
        rowCount: event.rowCount,
        truncated: event.truncated,
        errorCategory: event.errorCategory,
        createdAt: event.createdAt,
        completedAt: event.completedAt,
      })),
    })
  },
)
