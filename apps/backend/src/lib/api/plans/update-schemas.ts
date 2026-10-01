import { z } from 'zod'

import { agentPlanCreateStepSchema, agentPlanDecisionSchema } from './agent-schemas'
import {
  PLAN_LIMITS,
  commandStatusSchema,
  planLifecycleStatusSchema,
  planSchema,
} from './core-schemas'
import { normalizeAgentPlanStep, truncatePlanText } from './normalize'

export const listPlansQuerySchema = z.object({
  teamId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().datetime().optional(),
  mine: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
})

export const listPlansAgentInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum plans to return. Default 50.'),
  cursor: z
    .string()
    .datetime()
    .optional()
    .describe('Pagination cursor from a previous list result.'),
  mine: z.boolean().optional().describe('When true, list only plans created by the current user.'),
})

export const listPlansResponseSchema = z.object({
  plans: z.array(planSchema),
  nextCursor: z.string().datetime().nullable(),
  hasMore: z.boolean(),
})

export const planIdPathSchema = z.object({
  planId: z.string().min(1).describe('Public plan id, e.g. "2".'),
})

export const recordPlanApprovalBodySchema = z.object({
  teamId: z.string().min(1).optional(),
})

export const planApprovalPolicyQuerySchema = z.object({
  teamId: z.string().min(1),
})

export const updatePlanApprovalPolicyBodySchema = z.object({
  teamId: z.string().min(1),
  // All supported policies require the requester. The configurable dimension
  // is how many *other* members must additionally approve.
  requesterApprovalRequired: z.literal(true).default(true),
  minimumOtherApprovals: z.number().int().min(0).max(20),
})

const updatePlanBodyFieldsSchema = z.object({
  teamId: z.string().min(1).optional(),
  status: planLifecycleStatusSchema.optional(),
  commandStatuses: z
    .array(
      z.object({
        stepIdx: z.number().int().nonnegative(),
        jobIdx: z.number().int().nonnegative(),
        cmdIdx: z.number().int().nonnegative(),
        status: commandStatusSchema,
      }),
    )
    .optional(),
  commandResults: z
    .array(
      z.object({
        stepIdx: z.number().int().nonnegative(),
        jobIdx: z.number().int().nonnegative(),
        cmdIdx: z.number().int().nonnegative(),
        status: commandStatusSchema,
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        exitCode: z.number().int().optional(),
        executedBy: z.literal('agent').optional(),
      }),
    )
    .optional(),
  executionError: z.string().optional(),
  // Proposal construction / revision — the plan skill's REST path. Same
  // patch shapes UpdatePlanPatch accepts; content revisions only apply while
  // the plan is still `proposed` (enforced by updatePlan).
  title: z.string().min(1).optional().describe('New short approval-card title.'),
  overview: z.string().optional().describe('New short overview paragraph.'),
  decisions: z
    .array(agentPlanDecisionSchema)
    .max(PLAN_LIMITS.decisions)
    .optional()
    .describe('Replace the decisions section: key choices the user should review.'),
  appendStep: agentPlanCreateStepSchema
    .optional()
    .describe('Add one execution step. Send one step per request, in order.'),
  insertAt: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('0-based position to insert appendStep at; omit to append at the end.'),
  editStep: z
    .object({
      stepIdx: z.number().int().nonnegative(),
      step: agentPlanCreateStepSchema,
    })
    .optional()
    .describe('Replace one step (0-based stepIdx) with its complete revised version.'),
  removeStep: z
    .object({ stepIdx: z.number().int().nonnegative() })
    .optional()
    .describe('Remove one step; later steps shift up.'),
  costSummary: z.string().min(1).optional().describe('One short financial-impact headline.'),
  costOneTime: z.string().optional(),
  costMonthly: z.string().optional(),
  costSavings: z.string().optional(),
  riskWorstCase: z.string().min(1).optional().describe('One concise worst realistic outcome.'),
  riskMitigations: z.array(z.string().min(1)).min(1).optional(),
})

export const agentUpdatePlanBodyFieldsSchema = updatePlanBodyFieldsSchema
  .omit({ teamId: true, commandResults: true })
  .extend({
    // Approval and rejection are human decisions. They remain available to
    // existing clients through updatePlanBodySchema, but are deliberately not
    // exposed as agent tool inputs.
    status: z.enum(['executing', 'completed', 'failed', 'cancelled']).optional(),
  })

export const updatePlanBodySchema = updatePlanBodyFieldsSchema.refine(
  (value) =>
    value.status !== undefined ||
    (value.commandStatuses?.length ?? 0) > 0 ||
    (value.commandResults?.length ?? 0) > 0 ||
    value.executionError !== undefined ||
    value.title !== undefined ||
    value.overview !== undefined ||
    value.decisions !== undefined ||
    value.appendStep !== undefined ||
    value.editStep !== undefined ||
    value.removeStep !== undefined ||
    value.costSummary !== undefined ||
    value.riskWorstCase !== undefined,
  'patch must include at least one plan field (status, command progress, or a proposal-content revision)',
)

export type UpdatePlanBody = z.infer<typeof updatePlanBodySchema>
export type ListPlansAgentInput = z.infer<typeof listPlansAgentInputSchema>

// Truncate every construction field present on a plans.update PATCH body.
// Fields arrive independently on the REST path (the plan skill can send a
// costOneTime-only or riskWorstCase-only revision), so each is normalized on
// its own — no field's truncation is gated on a sibling being present.
export function normalizeAgentPlanUpdatePatch<
  T extends Partial<Omit<z.infer<typeof updatePlanBodyFieldsSchema>, 'teamId'>>,
>(patch: T): T {
  const out = { ...patch }

  if (out.title !== undefined) out.title = truncatePlanText(out.title, PLAN_LIMITS.title)
  if (out.overview !== undefined)
    out.overview = truncatePlanText(out.overview, PLAN_LIMITS.overview)
  if (out.decisions)
    out.decisions = out.decisions.slice(0, PLAN_LIMITS.decisions).map((decision) => ({
      label: truncatePlanText(decision.label, PLAN_LIMITS.decisionLabel),
      value: truncatePlanText(decision.value, PLAN_LIMITS.decisionValue),
    }))
  if (out.appendStep) out.appendStep = normalizeAgentPlanStep(out.appendStep)
  if (out.editStep)
    out.editStep = {
      stepIdx: out.editStep.stepIdx,
      step: normalizeAgentPlanStep(out.editStep.step),
    }
  if (out.costSummary !== undefined)
    out.costSummary = truncatePlanText(out.costSummary, PLAN_LIMITS.costSummary)
  if (out.costOneTime !== undefined)
    out.costOneTime = truncatePlanText(out.costOneTime, PLAN_LIMITS.costDetail)
  if (out.costMonthly !== undefined)
    out.costMonthly = truncatePlanText(out.costMonthly, PLAN_LIMITS.costDetail)
  if (out.costSavings !== undefined)
    out.costSavings = truncatePlanText(out.costSavings, PLAN_LIMITS.costDetail)
  if (out.riskWorstCase !== undefined)
    out.riskWorstCase = truncatePlanText(out.riskWorstCase, PLAN_LIMITS.riskWorstCase)
  if (out.riskMitigations)
    out.riskMitigations = out.riskMitigations
      .slice(0, PLAN_LIMITS.riskMitigations)
      .map((mitigation) => truncatePlanText(mitigation, PLAN_LIMITS.riskMitigation))

  return out
}
