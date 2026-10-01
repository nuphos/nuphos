import {
  getPlanApprovalProgress,
  normalizePlanApprovalRequirement,
  normalizePlanApprovals,
} from './approval-policy'

import type {
  CommandStatus,
  MongoDatabasePlanAction,
  MongoDatabasePlanActionDTO,
  Plan,
  PlanApproval,
  PlanApprovalProgress,
  PlanApprovalRequirement,
  PlanCommand,
  PlanStep,
} from './types'

export type PlanDTO = Omit<
  Plan,
  | '_id'
  | 'createdAt'
  | 'updatedAt'
  | 'approvedAt'
  | 'rejectedAt'
  | 'executionStartedAt'
  | 'executionFinishedAt'
  | 'approvalRequirement'
  | 'approvals'
  | 'actions'
> & {
  id: string
  createdAt: string
  updatedAt: string
  approvedAt?: string
  executionStartedAt?: string
  executionFinishedAt?: string
  rejectedAt?: string
  approvalRequirement: PlanApprovalRequirement
  approvals: (Omit<PlanApproval, 'approvedAt'> & { approvedAt: string })[]
  approvalProgress: PlanApprovalProgress
  actions: MongoDatabasePlanActionDTO[]
}

const COMMAND_STATUSES: ReadonlySet<CommandStatus> = new Set([
  'pending',
  'running',
  'done',
  'failed',
])

function serializePlanCommands(commands: unknown): PlanCommand[] {
  const list = Array.isArray(commands) ? commands : [commands]

  return list
    .filter((cmd): cmd is Record<string, unknown> => Boolean(cmd) && typeof cmd === 'object')
    .filter((cmd) => typeof cmd.command === 'string' && cmd.command.length > 0)
    .map((cmd) => ({
      command: cmd.command as string,
      description: typeof cmd.description === 'string' ? cmd.description : undefined,
      status: COMMAND_STATUSES.has(cmd.status as CommandStatus)
        ? (cmd.status as CommandStatus)
        : 'pending',
      stdout: typeof cmd.stdout === 'string' ? cmd.stdout : undefined,
      stderr: typeof cmd.stderr === 'string' ? cmd.stderr : undefined,
      exitCode: typeof cmd.exitCode === 'number' ? cmd.exitCode : undefined,
      executedBy: cmd.executedBy === 'agent' ? cmd.executedBy : undefined,
    }))
}

function serializePlanSteps(steps: unknown): PlanStep[] {
  if (!Array.isArray(steps)) return []

  return steps
    .filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object')
    .map((step) => ({
      title: typeof step.title === 'string' ? step.title : 'Untitled step',
      description: typeof step.description === 'string' ? step.description : undefined,
      jobs: Array.isArray(step.jobs)
        ? step.jobs
            .filter(
              (job): job is Record<string, unknown> => Boolean(job) && typeof job === 'object',
            )
            .map((job) => ({
              title: typeof job.title === 'string' ? job.title : 'Untitled job',
              description: typeof job.description === 'string' ? job.description : undefined,
              commands: serializePlanCommands(job.commands),
            }))
        : [],
    }))
}

function serializePlanActions(
  actions: MongoDatabasePlanAction[] | undefined,
): MongoDatabasePlanActionDTO[] {
  return (actions ?? []).map((action) => ({
    id: action.id,
    type: action.type,
    connectionId: action.connectionId,
    engine: action.engine,
    kind: action.kind,
    operation: action.operation,
    database: action.database,
    collection: action.collection,
    statementDigest: action.statementDigest,
    statementPreview: action.statementPreview,
    statementPreviewTruncated: action.statementPreviewTruncated,
    statementRedactedFields: action.statementRedactedFields,
    purpose: action.purpose,
    risk: action.risk,
    rollbackPlan: action.rollbackPlan,
    authorizedExecutorUserIds: action.authorizedExecutorUserIds,
    proposalSource: action.proposalSource,
    sourceAgentOrigin: action.sourceAgentOrigin,
    expiresAt: action.expiresAt?.toISOString() ?? null,
    executionId: action.executionId,
    executionStartedAt: action.executionStartedAt?.toISOString() ?? null,
    executionCompletedAt: action.executionCompletedAt?.toISOString() ?? null,
    executionResult: action.executionResult,
    executionErrorCategory: action.executionErrorCategory,
    executionErrorMessage: action.executionErrorMessage,
    events: action.events.map((event) => ({ ...event, at: event.at.toISOString() })),
  }))
}

export function serializePlan(row: Plan): PlanDTO {
  const approvalRequirement = normalizePlanApprovalRequirement(row)
  const approvals = normalizePlanApprovals(row)

  return {
    // The public id IS the per-scope number (#1, #2, …). The Mongo ObjectId
    // (`_id`) stays internal and is never exposed.
    id: String(row.number),
    teamId: row.teamId,
    createdBy: row.createdBy,
    sourceConversationId: row.sourceConversationId,
    number: row.number,
    title: row.title,
    overview: row.overview,
    decisions: row.decisions,
    steps: serializePlanSteps(row.steps),
    costSummary: row.costSummary,
    costOneTime: row.costOneTime,
    costMonthly: row.costMonthly,
    costSavings: row.costSavings,
    riskWorstCase: row.riskWorstCase,
    riskMitigations: row.riskMitigations,
    actions: serializePlanActions(row.actions),
    status: row.status,
    approvalRequirement,
    approvals: approvals.map((approval) => ({
      ...approval,
      approvedAt: approval.approvedAt.toISOString(),
    })),
    approvalProgress: getPlanApprovalProgress(row),
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString(),
    executionStartedAt: row.executionStartedAt?.toISOString(),
    executionFinishedAt: row.executionFinishedAt?.toISOString(),
    executionError: row.executionError,
    rejectedBy: row.rejectedBy,
    rejectedAt: row.rejectedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
