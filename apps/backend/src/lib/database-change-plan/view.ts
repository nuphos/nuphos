import {
  getPlanApprovalProgress,
  normalizePlanApprovalRequirement,
  normalizePlanApprovals,
} from '@/lib/agent/plans'

import type { MongoDatabasePlanAction, Plan } from '@/lib/agent/plans'

export function mongoDatabasePlanAction(
  plan: Plan,
  connectionId: string,
): MongoDatabasePlanAction | null {
  return (
    plan.actions?.find(
      (action): action is MongoDatabasePlanAction =>
        action.type === 'mongodb.change' && action.connectionId === connectionId,
    ) ?? null
  )
}

export function mongoPlanChangeStatus(
  plan: Plan,
  action: MongoDatabasePlanAction,
):
  | 'pending_approval'
  | 'approved'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'canceled'
  | 'expired' {
  if (action.events.some((event) => event.type === 'expired')) return 'expired'
  if (
    (plan.status === 'proposed' || plan.status === 'approved') &&
    action.expiresAt &&
    action.expiresAt.getTime() <= Date.now()
  )
    return 'expired'
  if (plan.status === 'proposed') return 'pending_approval'
  if (plan.status === 'completed') return 'succeeded'
  if (plan.status === 'cancelled') return 'canceled'

  return plan.status
}

export function mongoPlanChangeView(input: {
  plan: Plan
  action: MongoDatabasePlanAction
  userId: string
  teamRole: string
  memberCanUse: boolean
}) {
  const { plan, action, userId, teamRole, memberCanUse } = input
  const requirement = normalizePlanApprovalRequirement(plan)
  const approvals = normalizePlanApprovals(plan)
  const progress = getPlanApprovalProgress(plan)
  const status = mongoPlanChangeStatus(plan, action)
  const alreadyApproved = approvals.some((approval) => approval.userId === userId)
  const active = status === 'pending_approval' || status === 'approved'
  const actionEvents = action.events.map((event) => ({ ...event }))
  const approvalEvents = approvals.map((approval) => ({
    type: 'approved' as const,
    actorUserId: approval.userId,
    at: approval.approvedAt,
    comment: null,
  }))
  const decisionEvents = [
    ...(plan.rejectedBy && plan.rejectedAt
      ? [
          {
            type: 'rejected' as const,
            actorUserId: plan.rejectedBy,
            at: plan.rejectedAt,
            comment: null,
          },
        ]
      : []),
    ...(plan.status === 'cancelled'
      ? [
          {
            type: 'canceled' as const,
            actorUserId: plan.createdBy,
            at: plan.updatedAt,
            comment: null,
          },
        ]
      : []),
  ]

  return {
    id: String(plan.number),
    planId: String(plan.number),
    proposalSource: action.proposalSource,
    sourceConversationId: plan.sourceConversationId,
    kind: action.kind,
    operation: action.operation,
    database: action.database,
    collection: action.collection,
    title: plan.title,
    description: action.purpose,
    risk: action.risk,
    rollbackPlan: action.rollbackPlan,
    statementDigest: action.statementDigest,
    statementPreview: action.statementPreview,
    statementPreviewTruncated: action.statementPreviewTruncated,
    statementRedactedFields: action.statementRedactedFields,
    requesterUserId: plan.createdBy,
    authorizedExecutorUserIds: action.authorizedExecutorUserIds,
    approvals: approvals.map((approval) => ({
      userId: approval.userId,
      comment: null,
      createdAt: approval.approvedAt,
    })),
    requiredApprovals:
      Number(requirement.requesterApprovalRequired) + requirement.minimumOtherApprovals,
    currentApprovals: Number(progress.requesterApproved) + progress.otherApprovals,
    policyVersion: requirement.policyVersion,
    status,
    canEdit: false,
    canApprove: status === 'pending_approval' && memberCanUse && !alreadyApproved,
    canReject: status === 'pending_approval' && memberCanUse && plan.createdBy !== userId,
    canCancel: active && (plan.createdBy === userId || teamRole === 'ADMINISTRATOR'),
    canExecute:
      status === 'approved' &&
      progress.satisfied &&
      memberCanUse &&
      action.authorizedExecutorUserIds.includes(userId),
    expiresAt: action.expiresAt,
    executionId: action.executionId,
    executionStartedAt: action.executionStartedAt,
    executionCompletedAt: action.executionCompletedAt,
    executionResult: action.executionResult,
    executionErrorCategory: action.executionErrorCategory,
    executionErrorMessage: action.executionErrorMessage,
    events: [...actionEvents, ...approvalEvents, ...decisionEvents].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    ),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  }
}
