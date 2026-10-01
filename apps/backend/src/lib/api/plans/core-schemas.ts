import { z } from 'zod'

export const commandStatusSchema = z.enum(['pending', 'running', 'done', 'failed'])

export const planLifecycleStatusSchema = z.enum([
  'proposed',
  'approved',
  'rejected',
  'executing',
  'completed',
  'failed',
  'cancelled',
])

export const PLAN_LIMITS = {
  decisionLabel: 60,
  decisionValue: 200,
  command: 2000,
  commandDescription: 200,
  jobTitle: 120,
  jobDescription: 400,
  stepTitle: 80,
  stepDescription: 300,
  jobsPerStep: 12,
  commandsPerJob: 20,
  title: 120,
  overview: 400,
  decisions: 12,
  steps: 10,
  costSummary: 200,
  costDetail: 120,
  riskWorstCase: 400,
  riskMitigations: 8,
  riskMitigation: 200,
} as const

export const planDecisionSchema = z.object({
  label: z.string().min(1).max(PLAN_LIMITS.decisionLabel),
  value: z.string().min(1).max(PLAN_LIMITS.decisionValue),
})

const planCommandSchema = z.object({
  command: z.string().min(1).max(PLAN_LIMITS.command),
  description: z.string().max(PLAN_LIMITS.commandDescription).optional(),
  status: commandStatusSchema,
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().int().optional(),
  executedBy: z.literal('agent').optional(),
})

const planJobSchema = z.object({
  title: z.string().min(1).max(PLAN_LIMITS.jobTitle),
  description: z.string().max(PLAN_LIMITS.jobDescription).optional(),
  commands: z.array(planCommandSchema).optional(),
})

const planStepSchema = z.object({
  title: z.string().min(1).max(PLAN_LIMITS.stepTitle),
  description: z.string().max(PLAN_LIMITS.stepDescription).optional(),
  jobs: z.array(planJobSchema).min(1).max(PLAN_LIMITS.jobsPerStep),
})

export const planApprovalRequirementSchema = z.object({
  requesterApprovalRequired: z.boolean(),
  minimumOtherApprovals: z.number().int().min(0).max(20),
  policySource: z.enum(['legacy-default', 'team-policy']),
  policyVersion: z.number().int().nonnegative(),
})

export const planApprovalSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['requester', 'other']),
  policyVersion: z.number().int().nonnegative(),
  approvedAt: z.string().datetime(),
})

export const planApprovalProgressSchema = z.object({
  requesterApproved: z.boolean(),
  requesterApprovalRequired: z.boolean(),
  otherApprovals: z.number().int().nonnegative(),
  minimumOtherApprovals: z.number().int().nonnegative(),
  satisfied: z.boolean(),
})

const mongoDatabasePlanActionSchema = z.object({
  id: z.string(),
  type: z.literal('mongodb.change'),
  connectionId: z.string(),
  engine: z.literal('mongodb'),
  kind: z.enum(['dml', 'ddl']),
  operation: z.enum([
    'insertOne',
    'insertMany',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'createCollection',
    'dropCollection',
    'createIndex',
    'dropIndex',
  ]),
  database: z.string(),
  collection: z.string(),
  statementDigest: z.string(),
  statementPreview: z.string(),
  statementPreviewTruncated: z.boolean(),
  statementRedactedFields: z.array(z.string()),
  purpose: z.string(),
  risk: z.string(),
  rollbackPlan: z.string(),
  authorizedExecutorUserIds: z.array(z.string()),
  proposalSource: z.enum(['human', 'agent']),
  sourceAgentOrigin: z.enum(['user', 'trigger', 'automation']).optional(),
  expiresAt: z.string().datetime().nullable(),
  executionId: z.string().nullable(),
  executionStartedAt: z.string().datetime().nullable(),
  executionCompletedAt: z.string().datetime().nullable(),
  executionResult: z.record(z.unknown()).nullable(),
  executionErrorCategory: z
    .enum([
      'dns',
      'route',
      'tls',
      'authentication',
      'authorization',
      'database-unavailable',
      'unknown',
    ])
    .nullable(),
  executionErrorMessage: z.string().nullable(),
  events: z.array(
    z.object({
      type: z.enum([
        'created',
        'expired',
        'execution_started',
        'execution_succeeded',
        'execution_failed',
      ]),
      actorUserId: z.string(),
      at: z.string().datetime(),
      comment: z.string().nullable(),
    }),
  ),
})

const planCreateCommandSchema = planCommandSchema.omit({ status: true })
const planCreateJobSchema = planJobSchema.extend({
  commands: z.array(planCreateCommandSchema).max(PLAN_LIMITS.commandsPerJob).optional(),
})
const planCreateStepSchema = planStepSchema.extend({
  jobs: z.array(planCreateJobSchema).min(1).max(PLAN_LIMITS.jobsPerStep),
})

export const planSchema = z.object({
  id: z.string().describe('Public plan id. This is the per-scope plan number as a string.'),
  teamId: z.string().optional(),
  createdBy: z.string(),
  sourceConversationId: z.string().optional(),
  number: z.number().int().positive(),
  title: z.string(),
  overview: z.string().optional(),
  decisions: z.array(planDecisionSchema).optional(),
  steps: z.array(planStepSchema),
  costSummary: z.string().optional(),
  costOneTime: z.string().optional(),
  costMonthly: z.string().optional(),
  costSavings: z.string().optional(),
  riskWorstCase: z.string().optional(),
  riskMitigations: z.array(z.string()).optional(),
  actions: z.array(mongoDatabasePlanActionSchema),
  status: planLifecycleStatusSchema,
  approvalRequirement: planApprovalRequirementSchema,
  approvals: z.array(planApprovalSchema),
  approvalProgress: planApprovalProgressSchema,
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  executionStartedAt: z.string().datetime().optional(),
  executionFinishedAt: z.string().datetime().optional(),
  executionError: z.string().optional(),
  rejectedBy: z.string().optional(),
  rejectedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createPlanBodySchema = z.object({
  teamId: z.string().min(1).optional(),
  title: z.string().min(1).max(PLAN_LIMITS.title),
  overview: z.string().max(PLAN_LIMITS.overview).optional(),
  decisions: z.array(planDecisionSchema).max(PLAN_LIMITS.decisions).optional(),
  steps: z.array(planCreateStepSchema).min(1).max(PLAN_LIMITS.steps),
  costSummary: z.string().min(1).max(PLAN_LIMITS.costSummary),
  costOneTime: z.string().max(PLAN_LIMITS.costDetail).optional(),
  costMonthly: z.string().max(PLAN_LIMITS.costDetail).optional(),
  costSavings: z.string().max(PLAN_LIMITS.costDetail).optional(),
  riskWorstCase: z.string().min(1).max(PLAN_LIMITS.riskWorstCase),
  riskMitigations: z
    .array(z.string().min(1).max(PLAN_LIMITS.riskMitigation))
    .min(1)
    .max(PLAN_LIMITS.riskMitigations),
})

export type CreatePlanBody = z.infer<typeof createPlanBodySchema>
