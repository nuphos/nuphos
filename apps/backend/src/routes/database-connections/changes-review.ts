import { Hono } from 'hono'

import { journalPlanDecision } from '@/lib/agent/journal-capture'
import { recordPlanApproval } from '@/lib/agent/plans'
import { databaseChangeDecisionSchema } from '@/lib/api/database-connections'
import { validDatabaseChangeApprovalCount } from '@/lib/database-change-policy'
import { AppError } from '@/lib/errors'
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
import { changeApprovalPolicy } from '@/routes/database-connections/shared'

import type { ConnectionVariables } from '@/routes/database-connections/shared'

export const databaseConnectionChangeReviewRoutes = new Hono<{ Variables: ConnectionVariables }>()

databaseConnectionChangeReviewRoutes.post(
  '/changes/:changeId/submit',
  zv('json', databaseChangeDecisionSchema),
  async (c) => {
    const connection = requireMongoChangeConnection(
      c.get('databaseConnection'),
      c.get('userId'),
      c.get('teamRole'),
    )

    if (isPlanChangeId(c.req.param('changeId'))) {
      const { plan, action } = await findMongoPlanChange(connection, c.req.param('changeId'))

      // New database actions are proposed Plans immediately. Preserve the old
      // endpoint as an idempotent no-op for clients that still call submit.
      return c.json(
        mongoPlanViewForRequest(plan, action, connection, c.get('userId'), c.get('teamRole')),
      )
    }
    const request = await findDatabaseChange(connection, c.req.param('changeId'))

    if (request.requesterUserId !== c.get('userId'))
      throw new AppError(
        403,
        'database_change_submit_denied',
        'Only the requester can submit this change request.',
      )
    if (request.status !== 'draft')
      throw new AppError(
        409,
        'database_change_not_draft',
        'Only draft change requests can be submitted.',
      )
    const policy = changeApprovalPolicy(connection)
    const now = new Date()

    await databaseChangeRequests().updateOne(
      { _id: request._id, status: 'draft', requesterUserId: c.get('userId') },
      {
        $set: {
          status: 'pending_approval',
          approvals: [],
          policySnapshot: policy,
          updatedAt: now,
        },
        $push: {
          events: {
            type: 'submitted',
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

databaseConnectionChangeReviewRoutes.post(
  '/changes/:changeId/approve',
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

      if (current.plan.status !== 'proposed') {
        throw new AppError(
          409,
          'database_change_not_approvable',
          'This database Plan is not awaiting approval.',
        )
      }
      const result = await recordPlanApproval(
        changeId,
        { teamId: connection.teamId.toHexString(), userId: c.get('userId') },
        c.get('userId'),
      )

      if (!result.plan)
        throw new AppError(404, 'database_change_not_found', 'Database change Plan not found.')
      if (result.thresholdReached) {
        await journalPlanDecision(
          result.plan,
          { userId: c.get('userId'), teamId: connection.teamId.toHexString() },
          'approved',
        )
      }
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
        'database_change_self_approval_denied',
        'The requester cannot approve their own change request.',
      )
    if (request.status !== 'pending_approval' && request.status !== 'approved') {
      throw new AppError(
        409,
        'database_change_not_approvable',
        'This change request is not awaiting approval.',
      )
    }
    const policy = changeApprovalPolicy(connection)

    if (request.policySnapshot.version !== policy.version) {
      throw new AppError(
        409,
        'database_change_policy_changed',
        'The approval policy changed. The requester must resubmit under the current policy.',
      )
    }
    const now = new Date()
    const result = await databaseChangeRequests().updateOne(
      {
        _id: request._id,
        status: { $in: ['pending_approval', 'approved'] },
        requesterUserId: { $ne: c.get('userId') },
        approvals: {
          $not: {
            $elemMatch: {
              userId: c.get('userId'),
              digest: request.statementDigest,
              policyVersion: policy.version,
            },
          },
        },
      },
      {
        $push: {
          approvals: {
            userId: c.get('userId'),
            digest: request.statementDigest,
            policyVersion: policy.version,
            comment: c.req.valid('json').comment,
            createdAt: now,
          },
          events: {
            type: 'approved',
            actorUserId: c.get('userId'),
            at: now,
            comment: c.req.valid('json').comment,
          },
        },
        $set: { updatedAt: now },
      },
    )

    if (result.modifiedCount === 0)
      throw new AppError(
        409,
        'database_change_already_approved',
        'You already approved this change request.',
      )
    let next = await findDatabaseChange(connection, request._id.toHexString())

    if (
      validDatabaseChangeApprovalCount(next, policy) >= policy.minimumApprovals &&
      next.status === 'pending_approval'
    ) {
      await databaseChangeRequests().updateOne(
        { _id: next._id, status: 'pending_approval' },
        { $set: { status: 'approved', updatedAt: now } },
      )
      next = await findDatabaseChange(connection, request._id.toHexString())
    }

    return c.json(changeRequestView(next, connection, c.get('userId'), c.get('teamRole')))
  },
)
