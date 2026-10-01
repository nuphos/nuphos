import { Hono } from 'hono'

import { databaseChangeExecuteSchema } from '@/lib/api/database-connections'
import { invalidateMongoCatalogCache } from '@/lib/database-catalog'
import { mongoChangeStatementDigest, runMongoDatabaseChange } from '@/lib/database-change'
import { executeMongoDatabasePlan } from '@/lib/database-change-plan'
import { validDatabaseChangeApprovalCount } from '@/lib/database-change-policy'
import { canAccessDatabaseConnection, classifyDatabaseError } from '@/lib/database-connections'
import { decryptDatabaseCredential } from '@/lib/database-credentials'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'
import { zv } from '@/lib/validate'
import { databaseChangeRequests } from '@/models'
import {
  changeRequestView,
  findDatabaseChange,
  findMongoPlanChange,
  isPlanChangeId,
  mongoPlanViewForRequest,
  requireMongoChangeConnection,
} from '@/routes/database-connections/changes-shared'
import {
  changeApprovalPolicy,
  connectionNetwork,
  directConnectionUri,
} from '@/routes/database-connections/shared'

import type { MongoDatabaseChangeStatement } from '@/lib/database-change'
import type { ConnectionVariables } from '@/routes/database-connections/shared'

export const databaseConnectionChangeExecuteRoutes = new Hono<{ Variables: ConnectionVariables }>()

databaseConnectionChangeExecuteRoutes.post(
  '/changes/:changeId/execute',
  zv('json', databaseChangeExecuteSchema),
  async (c) => {
    const connection = requireMongoChangeConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    if (isPlanChangeId(c.req.param('changeId'))) {
      const changeId = c.req.param('changeId')
      const { idempotencyKey } = c.req.valid('json')
      let current = await findMongoPlanChange(connection, changeId)

      if (current.action.executionId === idempotencyKey) {
        return c.json(
          mongoPlanViewForRequest(
            current.plan,
            current.action,
            connection,
            c.get('userId'),
            c.get('teamRole'),
          ),
        )
      }
      await executeMongoDatabasePlan({
        connection,
        planId: changeId,
        executorUserId: c.get('userId'),
        idempotencyKey,
      })
      current = await findMongoPlanChange(connection, changeId)
      c.header('Cache-Control', 'no-store')

      return c.json(
        mongoPlanViewForRequest(
          current.plan,
          current.action,
          connection,
          c.get('userId'),
          c.get('teamRole'),
        ),
      )
    }
    let request = await findDatabaseChange(connection, c.req.param('changeId'))
    const { idempotencyKey } = c.req.valid('json')

    if (request.executionId === idempotencyKey)
      return c.json(changeRequestView(request, connection, c.get('userId'), c.get('teamRole')))
    const policy = changeApprovalPolicy(connection)

    if (
      request.status !== 'approved' ||
      validDatabaseChangeApprovalCount(request, policy) < policy.minimumApprovals
    ) {
      throw new AppError(
        409,
        'database_change_not_approved',
        'The current approval policy has not been satisfied.',
      )
    }
    if (!request.authorizedExecutorUserIds.includes(c.get('userId'))) {
      throw new AppError(
        403,
        'database_change_execution_denied',
        'You are not an authorized executor for this change request.',
      )
    }
    const members = await getTeamMembers(connection.teamId.toHexString())
    const executor = members.find((member) => member.id === c.get('userId'))

    if (!executor || !canAccessDatabaseConnection(connection.access, executor.id, executor.role)) {
      throw new AppError(
        403,
        'database_change_executor_access_denied',
        'The executor must remain an active team member with database access.',
      )
    }
    const now = new Date()
    const claimed = await databaseChangeRequests().updateOne(
      { _id: request._id, status: 'approved', executionId: null },
      {
        $set: {
          status: 'executing',
          executionId: idempotencyKey,
          executionStartedAt: now,
          updatedAt: now,
        },
        $push: {
          events: {
            type: 'execution_started',
            actorUserId: c.get('userId'),
            at: now,
            comment: null,
          },
        },
      },
    )

    if (claimed.modifiedCount === 0) {
      request = await findDatabaseChange(connection, request._id.toHexString())
      if (request.executionId === idempotencyKey)
        return c.json(changeRequestView(request, connection, c.get('userId'), c.get('teamRole')))
      throw new AppError(
        409,
        'database_change_already_claimed',
        'This change request has already been claimed for execution.',
      )
    }
    try {
      const statement = JSON.parse(
        decryptDatabaseCredential(request.encryptedStatement),
      ) as MongoDatabaseChangeStatement

      if (mongoChangeStatementDigest(statement) !== request.statementDigest) {
        throw new AppError(
          409,
          'database_change_digest_mismatch',
          'The encrypted statement no longer matches the approved digest.',
        )
      }
      const network = await connectionNetwork(connection)
      const result = await runMongoDatabaseChange(
        directConnectionUri(connection),
        statement,
        network.mongoOptions,
      )
      const completedAt = new Date()

      await databaseChangeRequests().updateOne(
        { _id: request._id, status: 'executing', executionId: idempotencyKey },
        {
          $set: {
            status: 'succeeded',
            executionResult: result,
            executionCompletedAt: completedAt,
            updatedAt: completedAt,
          },
          $push: {
            events: {
              type: 'execution_succeeded',
              actorUserId: c.get('userId'),
              at: completedAt,
              comment: null,
            },
          },
        },
      )
      invalidateMongoCatalogCache(connection._id.toHexString())
    } catch (error) {
      const classified = classifyDatabaseError(error)
      const completedAt = new Date()

      await databaseChangeRequests().updateOne(
        { _id: request._id, status: 'executing', executionId: idempotencyKey },
        {
          $set: {
            status: 'failed',
            executionCompletedAt: completedAt,
            updatedAt: completedAt,
            executionErrorCategory: classified.category,
            executionErrorMessage: classified.message,
          },
          $push: {
            events: {
              type: 'execution_failed',
              actorUserId: c.get('userId'),
              at: completedAt,
              comment: classified.message,
            },
          },
        },
      )
    }
    request = await findDatabaseChange(connection, request._id.toHexString())
    c.header('Cache-Control', 'no-store')

    return c.json(changeRequestView(request, connection, c.get('userId'), c.get('teamRole')))
  },
)
