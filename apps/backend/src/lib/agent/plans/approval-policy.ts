import { planApprovalPolicies, plans } from './collections'
import { LEGACY_PLAN_APPROVAL_REQUIREMENT } from './types'

import type { Plan, PlanApproval, PlanApprovalProgress, PlanApprovalRequirement } from './types'

function clampOtherApprovalCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.max(0, Math.min(20, value)) : 0
}

// Stored plans predate this field; absent means required.
function coerceRequesterApprovalRequired(value: unknown): boolean {
  return value !== false
}

export function normalizePlanApprovalRequirement(
  plan: Pick<Plan, 'approvalRequirement'>,
): PlanApprovalRequirement {
  const stored = plan.approvalRequirement

  if (!stored) return { ...LEGACY_PLAN_APPROVAL_REQUIREMENT }

  return {
    requesterApprovalRequired: coerceRequesterApprovalRequired(stored.requesterApprovalRequired),
    minimumOtherApprovals: clampOtherApprovalCount(stored.minimumOtherApprovals),
    policySource: stored.policySource === 'team-policy' ? 'team-policy' : 'legacy-default',
    policyVersion:
      typeof stored.policyVersion === 'number' && Number.isInteger(stored.policyVersion)
        ? Math.max(0, stored.policyVersion)
        : 0,
  }
}

export function normalizePlanApprovals(
  plan: Pick<Plan, 'createdBy' | 'approvals' | 'approvedBy' | 'approvedAt' | 'approvalRequirement'>,
): PlanApproval[] {
  const requirement = normalizePlanApprovalRequirement(plan)
  const stored = Array.isArray(plan.approvals) ? plan.approvals : []
  const valid = stored
    .filter(
      (approval) =>
        approval &&
        typeof approval.userId === 'string' &&
        approval.userId.length > 0 &&
        approval.policyVersion === requirement.policyVersion &&
        approval.approvedAt instanceof Date &&
        !Number.isNaN(approval.approvedAt.getTime()),
    )
    .map((approval) => ({
      ...approval,
      // Trust identity, not a stored display role, when reading old or
      // partially migrated documents.
      role: approval.userId === plan.createdBy ? ('requester' as const) : ('other' as const),
    }))

  if (valid.length > 0) return valid

  // Dual-read compatibility: an old approved plan has only approvedBy/At.
  // Synthesize its single approval in responses without mutating the document.
  if (stored.length === 0 && plan.approvedBy && plan.approvedAt instanceof Date) {
    return [
      {
        userId: plan.approvedBy,
        role: plan.approvedBy === plan.createdBy ? 'requester' : 'other',
        policyVersion: requirement.policyVersion,
        approvedAt: plan.approvedAt,
      },
    ]
  }

  return []
}

export function getPlanApprovalProgress(
  plan: Pick<Plan, 'createdBy' | 'approvals' | 'approvedBy' | 'approvedAt' | 'approvalRequirement'>,
): PlanApprovalProgress {
  const requirement = normalizePlanApprovalRequirement(plan)
  const approvals = normalizePlanApprovals(plan)
  const uniqueUsers = new Set<string>()
  let requesterApproved = false
  let otherApprovals = 0

  for (const approval of approvals) {
    if (uniqueUsers.has(approval.userId)) continue
    uniqueUsers.add(approval.userId)
    if (approval.userId === plan.createdBy) requesterApproved = true
    else otherApprovals += 1
  }

  return {
    requesterApproved,
    requesterApprovalRequired: requirement.requesterApprovalRequired,
    otherApprovals,
    minimumOtherApprovals: requirement.minimumOtherApprovals,
    satisfied:
      (!requirement.requesterApprovalRequired || requesterApproved) &&
      otherApprovals >= requirement.minimumOtherApprovals,
  }
}

export async function getTeamPlanApprovalRequirement(
  teamId: string,
): Promise<PlanApprovalRequirement> {
  const policy = await planApprovalPolicies().findOne({ _id: teamId })

  if (!policy) return { ...LEGACY_PLAN_APPROVAL_REQUIREMENT }

  return {
    requesterApprovalRequired: policy.requesterApprovalRequired,
    minimumOtherApprovals: clampOtherApprovalCount(policy.minimumOtherApprovals),
    policySource: 'team-policy',
    policyVersion: policy.version,
  }
}

export async function updateTeamPlanApprovalRequirement(input: {
  teamId: string
  requesterApprovalRequired: boolean
  minimumOtherApprovals: number
  updatedBy: string
}): Promise<PlanApprovalRequirement> {
  const now = new Date()
  const result = await planApprovalPolicies().findOneAndUpdate(
    { _id: input.teamId },
    {
      $set: {
        requesterApprovalRequired: input.requesterApprovalRequired,
        minimumOtherApprovals: clampOtherApprovalCount(input.minimumOtherApprovals),
        updatedAt: now,
        updatedBy: input.updatedBy,
      },
      $inc: { version: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  )
  const requirement: PlanApprovalRequirement = {
    requesterApprovalRequired: input.requesterApprovalRequired,
    minimumOtherApprovals: clampOtherApprovalCount(input.minimumOtherApprovals),
    policySource: 'team-policy',
    policyVersion: result?.version ?? 1,
  }

  // An administrator changing the policy is an explicit request to re-review
  // open plans. Terminal plans and execution history are never rewritten.
  await plans().updateMany(
    { teamId: input.teamId, status: 'proposed' },
    {
      $set: { approvalRequirement: requirement, updatedAt: now },
      $unset: { approvals: '', approvedBy: '', approvedAt: '' },
    },
  )

  return requirement
}
