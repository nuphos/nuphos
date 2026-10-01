import { callJson, teamQuery } from './http'

export type PlanCommandStatus = 'pending' | 'running' | 'done' | 'failed'
export type PlanLifecycleStatus =
  'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'cancelled'

export type PlanCommand = {
  command: string
  description?: string
  status: PlanCommandStatus
  stdout?: string
  stderr?: string
  exitCode?: number
  executedBy?: 'agent'
}

export type PlanJob = {
  title: string
  description?: string
  commands?: PlanCommand[]
}

export type PlanStep = {
  title: string
  description?: string
  jobs: PlanJob[]
}

export type PlanDecision = {
  label: string
  value: string
}

export type PlanApprovalRequirement = {
  requesterApprovalRequired: boolean
  minimumOtherApprovals: number
  policySource: 'legacy-default' | 'team-policy'
  policyVersion: number
}

export type PlanApproval = {
  userId: string
  role: 'requester' | 'other'
  policyVersion: number
  approvedAt: string
}

export type PlanApprovalProgress = {
  requesterApproved: boolean
  requesterApprovalRequired: boolean
  otherApprovals: number
  minimumOtherApprovals: number
  satisfied: boolean
}

export type Plan = {
  id: string
  teamId?: string
  createdBy: string
  number: number
  title: string
  overview?: string
  decisions?: PlanDecision[]
  steps: PlanStep[]
  costSummary: string
  costOneTime?: string
  costMonthly?: string
  costSavings?: string
  riskWorstCase: string
  riskMitigations: string[]
  status: PlanLifecycleStatus
  agentRunnable: boolean
  agentRunnableReason?: string
  approvalRequirement: PlanApprovalRequirement
  approvals: PlanApproval[]
  approvalProgress: PlanApprovalProgress
  approvedBy?: string
  approvedAt?: string
  executionStartedAt?: string
  executionFinishedAt?: string
  executionError?: string
  rejectedBy?: string
  rejectedAt?: string
  createdAt: string
  updatedAt: string
}

export type PlansPage = {
  plans: Plan[]
  nextCursor: string | null
  hasMore: boolean
}

export type PlanUpdatePatch = {
  status?: PlanLifecycleStatus
  commandStatuses?: {
    stepIdx: number
    jobIdx: number
    cmdIdx: number
    status: PlanCommandStatus
  }[]
  commandResults?: {
    stepIdx: number
    jobIdx: number
    cmdIdx: number
    status: PlanCommandStatus
    stdout?: string
    stderr?: string
    exitCode?: number
    executedBy?: 'agent'
  }[]
  executionError?: string
}

export async function listPlans(args: {
  teamId?: string
  mine?: boolean
  cursor?: string
  limit?: number
}): Promise<PlansPage> {
  const params = new URLSearchParams()

  if (args.cursor) params.set('cursor', args.cursor)
  if (args.limit) params.set('limit', String(args.limit))
  if (args.teamId) params.set('teamId', args.teamId)
  if (args.mine) params.set('mine', '1')
  const q = params.toString() ? `?${String(params)}` : ''

  return callJson<PlansPage>('GET', `/agent/plans${q}`)
}

export async function getPlan(planId: string, teamId?: string): Promise<Plan> {
  return callJson<Plan>('GET', `/agent/plans/${encodeURIComponent(planId)}${teamQuery(teamId)}`)
}

export async function updatePlan(
  planId: string,
  patch: PlanUpdatePatch,
  teamId?: string,
): Promise<Plan> {
  return callJson<Plan>(
    'PATCH',
    `/agent/plans/${encodeURIComponent(planId)}${teamQuery(teamId)}`,
    patch,
  )
}

export async function getPlanApprovalPolicy(teamId: string): Promise<PlanApprovalRequirement> {
  return callJson<PlanApprovalRequirement>(
    'GET',
    `/agent/plan-approval-policy?teamId=${encodeURIComponent(teamId)}`,
  )
}

export async function updatePlanApprovalPolicy(
  teamId: string,
  minimumOtherApprovals: number,
): Promise<PlanApprovalRequirement> {
  return callJson<PlanApprovalRequirement>('PUT', '/agent/plan-approval-policy', {
    teamId,
    requesterApprovalRequired: true,
    minimumOtherApprovals,
  })
}

export async function retryPlan(planId: string, teamId?: string): Promise<Plan> {
  return callJson<Plan>(
    'POST',
    `/agent/plans/${encodeURIComponent(planId)}/retry${teamQuery(teamId)}`,
    {},
  )
}
