import { getPlanDocument } from '@/lib/agent/plans'
import { mongoDatabasePlanAction, mongoPlanChangeView } from '@/lib/database-change-plan'
import { databaseChangePermissions } from '@/lib/database-change-policy'
import { canAccessDatabaseConnection } from '@/lib/database-connections'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'
import { parseObjectId } from '@/lib/objectid'
import { databaseChangeRequests } from '@/models'
import {
  canUseConnection,
  changeApprovalPolicy,
  requireConnectionAccess,
} from '@/routes/database-connections/shared'

import type { DatabaseChangeRequest, DatabaseConnection } from '@/models'

export function requireMongoChangeConnection(
  connection: DatabaseConnection,
  userId: string,
  teamRole: string,
): DatabaseConnection {
  requireConnectionAccess(connection, userId, teamRole)
  if (connection.engine !== 'mongodb') {
    throw new AppError(
      422,
      'database_change_engine_unavailable',
      'DML/DDL change requests are currently available for MongoDB connections only.',
    )
  }

  return connection
}

export function isOpenChangeStatus(status: DatabaseChangeRequest['status']): boolean {
  return status === 'draft' || status === 'pending_approval' || status === 'approved'
}

export function changeRequestView(
  request: DatabaseChangeRequest,
  connection: DatabaseConnection,
  userId: string,
  teamRole: string,
) {
  const policy = changeApprovalPolicy(connection)
  const memberCanUse = canUseConnection(connection, userId, teamRole)
  const permissions = databaseChangePermissions({ request, policy, userId, teamRole, memberCanUse })

  return {
    id: request._id.toHexString(),
    kind: request.kind,
    operation: request.operation,
    database: request.database,
    collection: request.collection,
    title: request.title,
    description: request.description,
    risk: request.risk,
    rollbackPlan: request.rollbackPlan,
    statementDigest: request.statementDigest,
    statementPreview: request.statementPreview,
    statementPreviewTruncated: request.statementPreviewTruncated,
    statementRedactedFields: request.statementRedactedFields,
    requesterUserId: request.requesterUserId,
    authorizedExecutorUserIds: request.authorizedExecutorUserIds,
    approvals: request.approvals.map((approval) => ({
      userId: approval.userId,
      comment: approval.comment,
      createdAt: approval.createdAt,
    })),
    requiredApprovals: policy.minimumApprovals,
    currentApprovals: permissions.currentApprovals,
    policyVersion: policy.version,
    status: request.status,
    canEdit: permissions.canEdit,
    canApprove: permissions.canApprove,
    canReject: permissions.canReject,
    canCancel: permissions.canCancel,
    canExecute: permissions.canExecute,
    expiresAt: request.expiresAt,
    executionId: request.executionId,
    executionStartedAt: request.executionStartedAt,
    executionCompletedAt: request.executionCompletedAt,
    executionResult: request.executionResult,
    executionErrorCategory: request.executionErrorCategory,
    executionErrorMessage: request.executionErrorMessage,
    events: request.events,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}

export function isPlanChangeId(changeId: string): boolean {
  return /^[1-9]\d*$/.test(changeId)
}

export async function findMongoPlanChange(connection: DatabaseConnection, changeId: string) {
  const plan = await getPlanDocument(changeId, {
    teamId: connection.teamId.toHexString(),
    userId: '',
  })
  const action = plan ? mongoDatabasePlanAction(plan, connection._id.toHexString()) : null

  if (!plan || !action) {
    throw new AppError(404, 'database_change_not_found', 'Database change Plan not found.')
  }

  return { plan, action }
}

export function mongoPlanViewForRequest(
  plan: Awaited<ReturnType<typeof findMongoPlanChange>>['plan'],
  action: Awaited<ReturnType<typeof findMongoPlanChange>>['action'],
  connection: DatabaseConnection,
  userId: string,
  teamRole: string,
) {
  return mongoPlanChangeView({
    plan,
    action,
    userId,
    teamRole,
    memberCanUse: canUseConnection(connection, userId, teamRole),
  })
}

export async function requireAuthorizedExecutors(
  connection: DatabaseConnection,
  requesterUserId: string,
  requested: string[],
): Promise<string[]> {
  const ids = [...new Set([requesterUserId, ...requested])]
  const members = await getTeamMembers(connection.teamId.toHexString())
  const byId = new Map(members.map((member) => [member.id, member]))

  for (const id of ids) {
    const member = byId.get(id)

    if (!member)
      throw new AppError(
        422,
        'database_change_executor_not_member',
        'Every authorized executor must be an active team member.',
      )
    if (!canAccessDatabaseConnection(connection.access, id, member.role)) {
      throw new AppError(
        422,
        'database_change_executor_access_denied',
        'Every authorized executor must have access to this database connection.',
      )
    }
  }

  return ids
}

export async function expireDatabaseChanges(connection: DatabaseConnection): Promise<void> {
  const now = new Date()

  await databaseChangeRequests().updateMany(
    {
      teamId: connection.teamId,
      connectionId: connection._id,
      status: { $in: ['draft', 'pending_approval', 'approved'] },
      expiresAt: { $ne: null, $lte: now },
    },
    { $set: { status: 'expired', updatedAt: now } },
  )
}

export async function findDatabaseChange(
  connection: DatabaseConnection,
  changeId: string,
): Promise<DatabaseChangeRequest> {
  const request = await databaseChangeRequests().findOne({
    _id: parseObjectId(changeId, 'changeId'),
    teamId: connection.teamId,
    connectionId: connection._id,
  })

  if (!request)
    throw new AppError(404, 'database_change_not_found', 'Database change request not found.')

  return request
}
