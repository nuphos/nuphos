import { Hono } from 'hono'

import { journalPlanDecision } from '@/lib/agent/journal-capture'
import { updatePlan } from '@/lib/agent/plans'
import { databaseChangeDecisionSchema } from '@/lib/api/database-connections'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { databaseChangeRequests } from '@/models'
import {
  changeRequestView,
  findDatabaseChange,
  findMongoPlanChange,
  isOpenChangeStatus,
  isPlanChangeId,
  mongoPlanViewForRequest,
  requireMongoChangeConnection,
} from '@/routes/database-connections/changes-shared'

import type { ConnectionVariables } from '@/routes/database-connections/shared'

export const databaseConnectionChangeDeclineRoutes = new Hono<{ Variables: ConnectionVariables }>()

databaseConnectionChangeDeclineRoutes.post(
  '/changes/:changeId/reject',
  zv('json', databaseChangeDecisionSchema),
  async (c) => {
    const connection = requireMongoChangeConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    if (isPlanChangeId(c.req.param('changeId'))) {
      const changeId = c.req.param('changeId')
      const current = await findMongoPlanChange(connection, changeId)

      if (current.plan.createdBy === c.get('userId')) {
        throw new AppError(
          403,
          'database_change_self_rejection_denied',
          'The requester cannot reject their own database Plan; cancel it instead.',
        )
      }
      if (current.plan.status !== 'proposed') {
        throw new AppError(
          409,
          'database_change_not_rejectable',
          'This database Plan is not awaiting a decision.',
        )
      }
      const nextDto = await updatePlan(
        changeId,
        { status: 'rejected', rejectedBy: c.get('userId') },
        { teamId: connection.teamId.toHexString(), userId: c.get('userId') },
      )

      if (!nextDto)
        throw new AppError(
          409,
          'database_change_decision_conflict',
          'The database Plan changed before the decision was recorded.',
        )
      await journalPlanDecision(
        nextDto,
        { userId: c.get('userId'), teamId: connection.teamId.toHexString() },
        'rejected',
      )
      const next = await findMongoPlanChange(connection, changeId)

      return c.json(
        mongoPlanViewForRequest(
          next.plan,
          next.action,
          connection,
          c.get('userId'),
          c.get('teamRole'),
        ),
      )
    }
    const request = await findDatabaseChange(connection, c.req.param('changeId'))

    if (request.requesterUserId === c.get('userId'))
      throw new AppError(
        403,
        'database_change_self_rejection_denied',
        'The requester cannot reject their own change request; cancel it instead.',
      )
    if (request.status !== 'pending_approval' && request.status !== 'approved')
      throw new AppError(
        409,
        'database_change_not_rejectable',
        'This change request is not awaiting a decision.',
      )
    const now = new Date()

    await databaseChangeRequests().updateOne(
      { _id: request._id, status: { $in: ['pending_approval', 'approved'] } },
      {
        $set: { status: 'rejected', updatedAt: now },
        $push: {
          events: {
            type: 'rejected',
            actorUserId: c.get('userId'),
            at: now,
            comment: c.req.valid('json').comment,
          },
        },
      },
    )
    const next = await findDatabaseChange(connection, request._id.toHexString())

    return c.json(changeRequestView(next, connection, c.get('userId'), c.get('teamRole')))
  },
)

databaseConnectionChangeDeclineRoutes.post(
  '/changes/:changeId/cancel',
  zv('json', databaseChangeDecisionSchema),
  async (c) => {
    const connection = requireMongoChangeConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    if (isPlanChangeId(c.req.param('changeId'))) {
      const changeId = c.req.param('changeId')
      const current = await findMongoPlanChange(connection, changeId)

      if (current.plan.createdBy !== c.get('userId') && c.get('teamRole') !== 'ADMINISTRATOR') {
        throw new AppError(
          403,
          'database_change_cancel_denied',
          'Only the requester or a team administrator can cancel this database Plan.',
        )
      }
      if (current.plan.status !== 'proposed' && current.plan.status !== 'approved') {
        throw new AppError(
          409,
          'database_change_not_cancelable',
          'This database Plan can no longer be canceled.',
        )
      }
      const nextDto = await updatePlan(
        changeId,
        { status: 'cancelled' },
        { teamId: connection.teamId.toHexString(), userId: c.get('userId') },
      )

      if (!nextDto)
        throw new AppError(
          409,
          'database_change_decision_conflict',
          'The database Plan changed before cancellation was recorded.',
        )
      const next = await findMongoPlanChange(connection, changeId)

      return c.json(
        mongoPlanViewForRequest(
          next.plan,
          next.action,
          connection,
          c.get('userId'),
          c.get('teamRole'),
        ),
      )
    }
    const request = await findDatabaseChange(connection, c.req.param('changeId'))

    if (request.requesterUserId !== c.get('userId') && c.get('teamRole') !== 'ADMINISTRATOR') {
      throw new AppError(
        403,
        'database_change_cancel_denied',
        'Only the requester or a team administrator can cancel this change request.',
      )
    }
    if (!isOpenChangeStatus(request.status))
      throw new AppError(
        409,
        'database_change_not_cancelable',
        'This change request can no longer be canceled.',
      )
    const now = new Date()

    await databaseChangeRequests().updateOne(
      { _id: request._id, status: { $in: ['draft', 'pending_approval', 'approved'] } },
      {
        $set: { status: 'canceled', updatedAt: now },
        $push: {
          events: {
            type: 'canceled',
            actorUserId: c.get('userId'),
            at: now,
            comment: c.req.valid('json').comment,
          },
        },
      },
    )
    const next = await findDatabaseChange(connection, request._id.toHexString())

    return c.json(changeRequestView(next, connection, c.get('userId'), c.get('teamRole')))
  },
)
