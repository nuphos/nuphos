import { Hono } from 'hono'

import { listMongoDatabasePlanDocuments } from '@/lib/agent/plans'
import {
  databaseChangeRequestCreateSchema,
  databaseChangeRequestListSchema,
  databaseChangeRequestUpdateSchema,
} from '@/lib/api/database-connections'
import {
  assertMongoChangeStatement,
  mongoChangeKind,
  mongoChangeStatementDigest,
  mongoChangeStatementPreview,
} from '@/lib/database-change'
import { mongoDatabasePlanAction, proposeMongoDatabasePlan } from '@/lib/database-change-plan'
import { encryptDatabaseCredential } from '@/lib/database-credentials'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { databaseChangeRequests } from '@/models'
import {
  changeRequestView,
  expireDatabaseChanges,
  findDatabaseChange,
  findMongoPlanChange,
  isPlanChangeId,
  mongoPlanViewForRequest,
  requireAuthorizedExecutors,
  requireMongoChangeConnection,
} from '@/routes/database-connections/changes-shared'

import type { MongoDatabaseChangeStatement } from '@/lib/database-change'
import type { ConnectionVariables } from '@/routes/database-connections/shared'

export const databaseConnectionChangeCrudRoutes = new Hono<{ Variables: ConnectionVariables }>()

databaseConnectionChangeCrudRoutes.get(
  '/changes',
  zv('query', databaseChangeRequestListSchema),
  async (c) => {
    const connection = requireMongoChangeConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    await expireDatabaseChanges(connection)
    const { status, limit } = c.req.valid('query')
    const [planRows, legacyRows] = await Promise.all([
      listMongoDatabasePlanDocuments({
        teamId: connection.teamId.toHexString(),
        connectionId: connection._id.toHexString(),
        limit,
      }),
      databaseChangeRequests()
        .find({
          teamId: connection.teamId,
          connectionId: connection._id,
          ...(status ? { status } : {}),
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
    ])
    const planChanges = planRows.flatMap((plan) => {
      const action = mongoDatabasePlanAction(plan, connection._id.toHexString())

      if (!action) return []
      const view = mongoPlanViewForRequest(
        plan,
        action,
        connection,
        c.get('userId'),
        c.get('teamRole'),
      )

      return status && view.status !== status ? [] : [view]
    })
    const legacyChanges = legacyRows.map((request) =>
      changeRequestView(request, connection, c.get('userId'), c.get('teamRole')),
    )
    const changes = [...planChanges, ...legacyChanges]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)

    c.header('Cache-Control', 'no-store')

    return c.json({ changes })
  },
)

databaseConnectionChangeCrudRoutes.post(
  '/changes',
  zv('json', databaseChangeRequestCreateSchema),
  async (c) => {
    const connection = requireMongoChangeConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )
    const input = c.req.valid('json')
    const statement = input.statement as MongoDatabaseChangeStatement
    const planDto = await proposeMongoDatabasePlan({
      connection,
      requesterUserId: c.get('userId'),
      requesterTeamRole: c.get('teamRole'),
      title: input.title,
      description: input.description,
      risk: input.risk,
      rollbackPlan: input.rollbackPlan,
      statement,
      authorizedExecutorUserIds: input.authorizedExecutorUserIds,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      proposalSource: 'human',
    })
    const { plan, action } = await findMongoPlanChange(connection, planDto.id)

    c.header('Cache-Control', 'no-store')

    return c.json(
      mongoPlanViewForRequest(plan, action, connection, c.get('userId'), c.get('teamRole')),
      201,
    )
  },
)

databaseConnectionChangeCrudRoutes.get('/changes/:changeId', async (c) => {
  const connection = requireMongoChangeConnection(
    c.get('databaseConnection'),
    c.get('userId'),
    c.get('teamRole'),
  )

  if (isPlanChangeId(c.req.param('changeId'))) {
    const { plan, action } = await findMongoPlanChange(connection, c.req.param('changeId'))

    c.header('Cache-Control', 'no-store')

    return c.json(
      mongoPlanViewForRequest(plan, action, connection, c.get('userId'), c.get('teamRole')),
    )
  }
  await expireDatabaseChanges(connection)
  const request = await findDatabaseChange(connection, c.req.param('changeId'))

  c.header('Cache-Control', 'no-store')

  return c.json(changeRequestView(request, connection, c.get('userId'), c.get('teamRole')))
})

databaseConnectionChangeCrudRoutes.patch(
  '/changes/:changeId',
  zv('json', databaseChangeRequestUpdateSchema),
  async (c) => {
    const connection = requireMongoChangeConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    if (isPlanChangeId(c.req.param('changeId'))) {
      throw new AppError(
        409,
        'database_change_plan_immutable',
        'A proposed database Plan is immutable. Cancel it and create a revised Plan instead.',
      )
    }
    const current = await findDatabaseChange(connection, c.req.param('changeId'))

    if (current.requesterUserId !== c.get('userId'))
      throw new AppError(
        403,
        'database_change_edit_denied',
        'Only the requester can edit this change request.',
      )
    if (current.status !== 'draft')
      throw new AppError(
        409,
        'database_change_not_draft',
        'Only draft change requests can be edited.',
      )
    const input = c.req.valid('json')
    let statement: MongoDatabaseChangeStatement | null = null

    if (input.statement) {
      statement = input.statement
      try {
        assertMongoChangeStatement(statement)
      } catch (error) {
        throw new AppError(
          422,
          'database_change_statement_rejected',
          error instanceof Error ? error.message : 'Invalid MongoDB change statement.',
        )
      }
    }
    const executors = input.authorizedExecutorUserIds
      ? await requireAuthorizedExecutors(
          connection,
          current.requesterUserId,
          input.authorizedExecutorUserIds,
        )
      : current.authorizedExecutorUserIds
    const preview = statement ? mongoChangeStatementPreview(statement) : null
    const now = new Date()
    const updates = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.risk !== undefined ? { risk: input.risk } : {}),
      ...(input.rollbackPlan !== undefined ? { rollbackPlan: input.rollbackPlan } : {}),
      ...(input.expiresAt !== undefined
        ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
        : {}),
      authorizedExecutorUserIds: executors,
      ...(statement && preview
        ? {
            kind: mongoChangeKind(statement.operation),
            operation: statement.operation,
            database: statement.database,
            collection: statement.collection,
            encryptedStatement: encryptDatabaseCredential(JSON.stringify(statement)),
            statementDigest: mongoChangeStatementDigest(statement),
            statementPreview: preview.statement,
            statementPreviewTruncated: preview.truncated,
            statementRedactedFields: preview.redactedFields,
          }
        : {}),
      updatedAt: now,
    }

    await databaseChangeRequests().updateOne(
      { _id: current._id, status: 'draft', requesterUserId: c.get('userId') },
      {
        $set: updates,
        $push: {
          events: { type: 'updated', actorUserId: c.get('userId'), at: now, comment: null },
        },
      },
    )
    const next = await findDatabaseChange(connection, current._id.toHexString())

    c.header('Cache-Control', 'no-store')

    return c.json(changeRequestView(next, connection, c.get('userId'), c.get('teamRole')))
  },
)
