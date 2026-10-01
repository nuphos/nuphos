import {
  getPlanApprovalProgress,
  normalizePlanApprovalRequirement,
  normalizePlanApprovals,
} from './approval-policy'
import { plans } from './collections'
import { parsePlanNumber, scopedNumberFilter } from './scope'
import { serializePlan } from './serialize'

import type { PlanScope } from './scope'
import type { PlanDTO } from './serialize'
import type { PlanApproval } from './types'

export type RecordPlanApprovalResult = {
  plan: PlanDTO | null
  recorded: boolean
  thresholdReached: boolean
}

export async function recordPlanApproval(
  id: string,
  scope: PlanScope,
  userId: string,
): Promise<RecordPlanApprovalResult> {
  const planNumber = parsePlanNumber(id)

  if (planNumber == null) return { plan: null, recorded: false, thresholdReached: false }
  const baseFilter = scopedNumberFilter(planNumber, scope)
  const current = await plans().findOne(baseFilter)

  if (!current) return { plan: null, recorded: false, thresholdReached: false }
  if (current.status !== 'proposed') {
    return {
      plan: serializePlan(current),
      recorded: false,
      thresholdReached: current.status === 'approved',
    }
  }

  const expiredAction = current.actions?.find(
    (action) =>
      action.type === 'mongodb.change' && action.expiresAt && action.expiresAt <= new Date(),
  )

  if (expiredAction) {
    const expiredAt = new Date()
    const cancelled = await plans().findOneAndUpdate(
      { ...baseFilter, status: 'proposed' },
      {
        $set: { status: 'cancelled', updatedAt: expiredAt },
        $push: {
          'actions.$[action].events': {
            type: 'expired',
            actorUserId: 'system',
            at: expiredAt,
            comment: 'The database change Plan expired before approval.',
          },
        },
      },
      { returnDocument: 'after', arrayFilters: [{ 'action.id': expiredAction.id }] },
    )
    const latest = cancelled ?? (await plans().findOne(baseFilter))

    return {
      plan: latest ? serializePlan(latest) : null,
      recorded: false,
      thresholdReached: false,
    }
  }

  const requirement = normalizePlanApprovalRequirement(current)
  const existing = normalizePlanApprovals(current).some(
    (approval) =>
      approval.userId === userId && approval.policyVersion === requirement.policyVersion,
  )
  let updated = current
  let recorded = false

  if (!existing) {
    const now = new Date()
    const approval: PlanApproval = {
      userId,
      role: userId === current.createdBy ? 'requester' : 'other',
      policyVersion: requirement.policyVersion,
      approvedAt: now,
    }
    const appended = await plans().findOneAndUpdate(
      {
        ...baseFilter,
        status: 'proposed',
        approvals: {
          $not: { $elemMatch: { userId, policyVersion: requirement.policyVersion } },
        },
      },
      {
        $set: { approvalRequirement: requirement, updatedAt: now },
        $push: { approvals: approval },
      },
      { returnDocument: 'after' },
    )

    if (appended) {
      updated = appended
      recorded = true
    } else {
      updated = (await plans().findOne(baseFilter)) ?? current
    }
  }

  const progress = getPlanApprovalProgress(updated)

  if (!progress.satisfied || updated.status !== 'proposed') {
    return { plan: serializePlan(updated), recorded, thresholdReached: false }
  }

  const approvedAt = new Date()
  const transitioned = await plans().findOneAndUpdate(
    { ...baseFilter, status: 'proposed' },
    {
      $set: {
        status: 'approved',
        // Legacy consumers keep seeing the identity that completed the gate.
        approvedBy: userId,
        approvedAt,
        updatedAt: approvedAt,
      },
    },
    { returnDocument: 'after' },
  )
  const finalPlan = transitioned ?? (await plans().findOne(baseFilter))

  return {
    plan: finalPlan ? serializePlan(finalPlan) : null,
    recorded,
    // True only for the request that performed the transition. Concurrent or
    // retried approvals must not emit duplicate decision-journal entries.
    thresholdReached: transitioned != null,
  }
}
