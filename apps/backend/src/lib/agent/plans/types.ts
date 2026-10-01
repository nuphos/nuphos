import type {
  DatabaseChangeKind,
  DatabaseErrorCategory,
  EncryptedEnvelope,
  MongoDatabaseChangeOperation,
} from '@/models'
import type { ObjectId } from 'mongodb'

export type CommandStatus = 'pending' | 'running' | 'done' | 'failed'

export type PlanApprovalPolicySource = 'legacy-default' | 'team-policy'

export type PlanApprovalRequirement = {
  requesterApprovalRequired: boolean
  minimumOtherApprovals: number
  policySource: PlanApprovalPolicySource
  policyVersion: number
}

export type PlanApproval = {
  userId: string
  role: 'requester' | 'other'
  policyVersion: number
  approvedAt: Date
}

export type PlanApprovalProgress = {
  requesterApproved: boolean
  requesterApprovalRequired: boolean
  otherApprovals: number
  minimumOtherApprovals: number
  satisfied: boolean
}

export const LEGACY_PLAN_APPROVAL_REQUIREMENT: Readonly<PlanApprovalRequirement> = {
  requesterApprovalRequired: true,
  minimumOtherApprovals: 0,
  policySource: 'legacy-default',
  policyVersion: 0,
}

export type PlanLifecycleStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  // User abandoned the plan ("mark as unplanned") — distinct from `rejected`
  // (declined the agent's proposal). Terminal.
  | 'cancelled'

// A decided option for the plan as a whole — the choices the agent made that
// the user is really confirming when they approve (account, region, target
// resource, duration, quantity, …). These belong in the plan header, NOT as a
// fake "decide X" execution step.
export type PlanDecision = {
  label: string
  value: string
}

export type PlanCommand = {
  command: string
  description?: string
  status: CommandStatus
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

export type PlanProposalSource = 'human' | 'agent'

export type MongoDatabasePlanActionEvent = {
  type: 'created' | 'expired' | 'execution_started' | 'execution_succeeded' | 'execution_failed'
  actorUserId: string
  at: Date
  comment: string | null
}

/**
 * A database mutation is reviewable Plan content, not a second ticket
 * lifecycle. The exact executable statement is sealed independently from the
 * database credential and is deliberately removed by serializePlan().
 */
export type MongoDatabasePlanAction = {
  id: string
  type: 'mongodb.change'
  connectionId: string
  engine: 'mongodb'
  kind: DatabaseChangeKind
  operation: MongoDatabaseChangeOperation
  database: string
  collection: string
  encryptedStatement: EncryptedEnvelope
  statementDigest: string
  statementPreview: string
  statementPreviewTruncated: boolean
  statementRedactedFields: string[]
  purpose: string
  risk: string
  rollbackPlan: string
  authorizedExecutorUserIds: string[]
  proposalSource: PlanProposalSource
  sourceAgentOrigin?: 'user' | 'trigger' | 'automation'
  expiresAt: Date | null
  executionId: string | null
  executionStartedAt: Date | null
  executionCompletedAt: Date | null
  executionResult: Record<string, unknown> | null
  executionErrorCategory: DatabaseErrorCategory | null
  executionErrorMessage: string | null
  events: MongoDatabasePlanActionEvent[]
}

export type MongoDatabasePlanActionDTO = Omit<
  MongoDatabasePlanAction,
  'encryptedStatement' | 'expiresAt' | 'executionStartedAt' | 'executionCompletedAt' | 'events'
> & {
  expiresAt: string | null
  executionStartedAt: string | null
  executionCompletedAt: string | null
  events: (Omit<MongoDatabasePlanActionEvent, 'at'> & { at: string })[]
}

export type Plan = {
  _id?: ObjectId
  teamId?: string
  createdBy: string
  sourceConversationId?: string
  /**
   * Human-readable, GitHub-PR-style sequential id (#1, #2, …). Monotonic per
   * scope: per-team for team plans, per-user for personal (no-team) plans.
   * Assigned at creation via an atomic counter.
   */
  number: number
  title: string
  overview?: string
  decisions?: PlanDecision[]
  steps: PlanStep[]
  costSummary?: string
  costOneTime?: string
  costMonthly?: string
  costSavings?: string
  riskWorstCase?: string
  riskMitigations?: string[]
  actions?: MongoDatabasePlanAction[]
  status: PlanLifecycleStatus
  /** Optional so plans written before multi-approval shipped stay readable. */
  approvalRequirement?: PlanApprovalRequirement
  /** Optional for the same reason; approvedBy/approvedAt remain dual-written. */
  approvals?: PlanApproval[]
  approvedBy?: string
  approvedAt?: Date
  executionStartedAt?: Date
  executionFinishedAt?: Date
  executionError?: string
  rejectedBy?: string
  rejectedAt?: Date
  createdAt: Date
  updatedAt: Date
}
