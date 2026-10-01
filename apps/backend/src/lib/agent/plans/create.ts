import { getTeamPlanApprovalRequirement } from './approval-policy'
import { nextPlanNumber, planCounterScope, plans } from './collections'
import { serializePlan } from './serialize'
import { buildPlanStepDoc } from './steps'
import { LEGACY_PLAN_APPROVAL_REQUIREMENT } from './types'

import type { PlanDTO } from './serialize'
import type { MongoDatabasePlanAction, Plan, PlanApprovalRequirement, PlanDecision } from './types'

export type CreatePlanInput = {
  teamId?: string
  createdBy: string
  sourceConversationId?: string
  title: string
  overview?: string
  decisions?: PlanDecision[]
  steps: {
    title: string
    description?: string
    jobs: {
      title: string
      description?: string
      commands?: { command: string; description?: string }[]
    }[]
  }[]
  costSummary?: string
  costOneTime?: string
  costMonthly?: string
  costSavings?: string
  riskWorstCase?: string
  riskMitigations?: string[]
  /** Server-owned typed actions. Never accepted from the generic Plan API. */
  actions?: MongoDatabasePlanAction[]
  /** Internal override for callers that already resolved a policy snapshot. */
  approvalRequirement?: PlanApprovalRequirement
}

export async function createPlan(input: CreatePlanInput): Promise<PlanDTO> {
  const now = new Date()
  const approvalRequirement =
    input.approvalRequirement ??
    (input.teamId
      ? await getTeamPlanApprovalRequirement(input.teamId)
      : { ...LEGACY_PLAN_APPROVAL_REQUIREMENT })
  const number = await nextPlanNumber(
    planCounterScope({ teamId: input.teamId, createdBy: input.createdBy }),
  )
  const doc: Plan = {
    teamId: input.teamId,
    createdBy: input.createdBy,
    sourceConversationId: input.sourceConversationId,
    number,
    title: input.title,
    overview: input.overview,
    decisions: input.decisions,
    steps: input.steps.map(buildPlanStepDoc),
    costSummary: input.costSummary,
    costOneTime: input.costOneTime,
    costMonthly: input.costMonthly,
    costSavings: input.costSavings,
    riskWorstCase: input.riskWorstCase,
    riskMitigations: input.riskMitigations,
    actions: input.actions,
    status: 'proposed',
    approvalRequirement,
    approvals: [],
    createdAt: now,
    updatedAt: now,
  }
  const res = await plans().insertOne(doc)

  return serializePlan({ ...doc, _id: res.insertedId })
}
