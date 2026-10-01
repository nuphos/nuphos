import { z } from 'zod'

import { PLAN_LIMITS } from './core-schemas'

export const COMPACT_PLAN_TEXT =
  'Keep this compact for an approval card. Do not paste logs, YAML/JSON manifests, heredocs, diffs, or long prose here; summarize and defer bulky detail to execution.'

export const agentPlanDecisionSchema = z.object({
  label: z.string().min(1).describe('Short decision label, usually 1-4 words.'),
  value: z.string().min(1).describe(`Short chosen value. ${COMPACT_PLAN_TEXT}`),
})

const agentPlanCreateCommandSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      'Short executable command only. Avoid heredocs, inline YAML/JSON, base64, generated files, or giant one-liners. If the real work needs bulky content, create/reference a file during execution instead of embedding it in plan_create.',
    ),
  description: z.string().optional().describe(`One concise sentence. ${COMPACT_PLAN_TEXT}`),
})

const agentPlanCreateJobSchema = z.object({
  title: z.string().min(1).describe('Short job title, usually 3-8 words.'),
  description: z.string().optional().describe(`One concise sentence. ${COMPACT_PLAN_TEXT}`),
  commands: z
    .array(agentPlanCreateCommandSchema)
    .optional()
    .describe(
      'Use only the commands needed for approval. Prefer a few short commands over many detailed variants; defer verbose setup to execution.',
    ),
})

export const agentPlanCreateStepSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe(
      'Short step title, usually 3-8 words. Required on the step itself — the top-level label field is transient UI status text, not the step title.',
    ),
  description: z.string().optional().describe(`One concise sentence. ${COMPACT_PLAN_TEXT}`),
  jobs: z
    .array(agentPlanCreateJobSchema)
    .min(1)
    .describe(
      'Keep the approval card small: usually 1-3 jobs per step. Split or defer detail instead of listing every low-level operation.',
    ),
})

export const agentCreatePlanInputSchema = z.object({
  title: z.string().min(1).describe('Short approval-card title.'),
  overview: z.string().optional().describe(`One short paragraph. ${COMPACT_PLAN_TEXT}`),
})

export type AgentCreatePlanInput = z.infer<typeof agentCreatePlanInputSchema>

export const agentSetPlanDecisionsInputSchema = z.object({
  planId: z.string().min(1).describe('Plan id returned by plan_create.'),
  decisions: z
    .array(agentPlanDecisionSchema)
    .max(PLAN_LIMITS.decisions)
    .describe(
      'Key choices the user should review. Keep values short; do not use decisions as a place to dump diagnostics.',
    ),
})

export const agentAddPlanStepInputSchema = z.object({
  planId: z.string().min(1).describe('Plan id returned by plan_create.'),
  step: agentPlanCreateStepSchema.describe(
    'One execution step. Call this once per step instead of sending all steps at once.',
  ),
  insertAt: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      '0-based position to insert this step at; existing steps at or after it shift down. Omit to append at the end. Inserting is only allowed while the plan is still proposed.',
    ),
})

export const agentEditPlanStepInputSchema = z.object({
  planId: z.string().min(1).describe('Plan id returned by plan_create.'),
  stepIdx: z
    .number()
    .int()
    .nonnegative()
    .describe(
      '0-based index of the step to replace, in the order shown by GET /agent/plans/{planId}.',
    ),
  step: agentPlanCreateStepSchema.describe(
    'Full replacement for the step at stepIdx — send the complete revised step, not a diff.',
  ),
})

export const agentRemovePlanStepInputSchema = z.object({
  planId: z.string().min(1).describe('Plan id returned by plan_create.'),
  stepIdx: z
    .number()
    .int()
    .nonnegative()
    .describe('0-based index of the step to remove. Later steps shift up.'),
})

// Plain ZodObject (no refine) so tool wiring can still .merge() the label
// field onto it; the at-least-one-field check lives at the tool layer.
export const agentSetPlanMetaInputSchema = z.object({
  planId: z.string().min(1).describe('Plan id returned by plan_create.'),
  title: z.string().min(1).optional().describe('New short approval-card title.'),
  overview: z.string().optional().describe(`New short overview paragraph. ${COMPACT_PLAN_TEXT}`),
})

export const agentSetPlanCostInputSchema = z.object({
  planId: z.string().min(1).describe('Plan id returned by plan_create.'),
  costSummary: z.string().min(1).describe('One short financial-impact headline.'),
  costOneTime: z.string().optional().describe('Short one-time cost detail, if relevant.'),
  costMonthly: z.string().optional().describe('Short monthly cost detail, if relevant.'),
  costSavings: z.string().optional().describe('Short savings detail, if relevant.'),
})

export const agentSetPlanRiskInputSchema = z.object({
  planId: z.string().min(1).describe('Plan id returned by plan_create.'),
  riskWorstCase: z
    .string()
    .min(1)
    .describe(`One concise worst realistic outcome. ${COMPACT_PLAN_TEXT}`),
  riskMitigations: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Concrete short mitigations. Usually 1-4 items; do not paste a full rollback runbook.',
    ),
})

export type AgentSetPlanDecisionsInput = z.infer<typeof agentSetPlanDecisionsInputSchema>
export type AgentAddPlanStepInput = z.infer<typeof agentAddPlanStepInputSchema>
export type AgentEditPlanStepInput = z.infer<typeof agentEditPlanStepInputSchema>
export type AgentRemovePlanStepInput = z.infer<typeof agentRemovePlanStepInputSchema>
export type AgentSetPlanMetaInput = z.infer<typeof agentSetPlanMetaInputSchema>
export type AgentSetPlanCostInput = z.infer<typeof agentSetPlanCostInputSchema>
export type AgentSetPlanRiskInput = z.infer<typeof agentSetPlanRiskInputSchema>
