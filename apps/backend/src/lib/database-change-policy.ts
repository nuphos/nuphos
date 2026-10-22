import type { DatabaseChangeApprovalPolicy, DatabaseChangeRequest } from '@/models'

type ChangePermissionInput = {
  request: Pick<
    DatabaseChangeRequest,
    'status' | 'requesterUserId' | 'authorizedExecutorUserIds' | 'approvals' | 'statementDigest'
  >
  policy: Pick<DatabaseChangeApprovalPolicy, 'minimumApprovals' | 'version'>
  userId: string
  teamRole: string
  memberCanUse: boolean
}

export function validDatabaseChangeApprovalCount(
  request: Pick<DatabaseChangeRequest, 'approvals' | 'statementDigest'>,
  policy: Pick<DatabaseChangeApprovalPolicy, 'version'>,
): number {
  return new Set(
    request.approvals
      .filter(
        (approval) =>
          approval.digest === request.statementDigest && approval.policyVersion === policy.version,
      )
      .map((approval) => approval.userId),
  ).size
}

export function databaseChangePermissions({
  request,
  policy,
  userId,
  teamRole,
  memberCanUse,
}: ChangePermissionInput) {
  const currentApprovals = validDatabaseChangeApprovalCount(request, policy)
  const alreadyApproved = request.approvals.some(
    (approval) =>
      approval.userId === userId &&
      approval.digest === request.statementDigest &&
      approval.policyVersion === policy.version,
  )
  const approvable = request.status === 'pending_approval' || request.status === 'approved'
  const open = request.status === 'draft' || approvable
  const executable = request.status === 'approved' && currentApprovals >= policy.minimumApprovals
  // Viewers only read; every step of a change is a write.
  const writer = memberCanUse && teamRole !== 'VIEWER'

  return {
    currentApprovals,
    canEdit: writer && request.status === 'draft' && request.requesterUserId === userId,
    canApprove: approvable && writer && request.requesterUserId !== userId && !alreadyApproved,
    canReject: approvable && writer && request.requesterUserId !== userId,
    canCancel: open && (request.requesterUserId === userId || teamRole === 'ADMINISTRATOR'),
    canExecute: executable && writer && request.authorizedExecutorUserIds.includes(userId),
  }
}
