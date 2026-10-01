import { z } from 'zod'

import { agentPlanCreateStepSchema, agentPlanDecisionSchema } from './agent-schemas'
import { PLAN_LIMITS } from './core-schemas'
import { normalizeAgentPlanStep, truncateOptionalPlanText, truncatePlanText } from './normalize'

import type { CreatePlanBody } from './core-schemas'

// Max length of the transient `label` UI field, shared by every agent tool.
const LABEL_MAX_LENGTH = 160

// plan_create preprocess: the model imitates the legacy single-call format
// from older conversation history, which misses the `label` field (or
// occasionally `title`), so validation used to hard-fail. Backfill one from
// the other when exactly one is present; leave both-present / both-absent for
// the schema to handle.
export function backfillPlanCreateInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const value = raw as Record<string, unknown>
  const hasLabel = typeof value.label === 'string' && value.label.length > 0
  const hasTitle = typeof value.title === 'string' && value.title.length > 0

  if (hasLabel === hasTitle) return raw
  if (hasTitle) return { ...value, label: (value.title as string).slice(0, LABEL_MAX_LENGTH) }

  return { ...value, title: value.label }
}

// plan_add_step / plan_edit_step preprocess: the model routinely writes the
// step title into the generic `label` field and omits the required
// `step.title` (every plan_add_step failure in Braintrust over two weeks was
// exactly this). Backfill `step.title` from `label` instead of bouncing the
// call back to the model.
export function backfillStepTitleFromLabel(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const value = raw as Record<string, unknown>
  const step = value.step

  if (!step || typeof step !== 'object' || Array.isArray(step)) return raw
  if ((step as Record<string, unknown>).title !== undefined) return raw
  if (typeof value.label !== 'string' || value.label.length === 0) return raw

  return { ...value, step: { ...step, title: value.label } }
}

// Legacy single-call plan_create payloads. Before plans were built
// incrementally, plan_create took the whole plan in one call, and the model
// still occasionally imitates that shape from older conversation history.
// Rather than silently stripping the bulky sections (leaving an empty shell
// the user can never approve), parse and honor whatever sections are valid.
const legacyPlanCreateStepSchema = agentPlanCreateStepSchema.extend({
  // Same label-confusion era: legacy steps sometimes carry no title.
  title: z.string().min(1).optional(),
})

const legacyPlanCreateExtrasSchema = z.object({
  decisions: z.array(agentPlanDecisionSchema).optional(),
  steps: z.array(legacyPlanCreateStepSchema).optional(),
  costSummary: z.string().min(1).optional(),
  costOneTime: z.string().min(1).optional(),
  costMonthly: z.string().min(1).optional(),
  costSavings: z.string().min(1).optional(),
  riskWorstCase: z.string().min(1).optional(),
  riskMitigations: z.array(z.string().min(1)).optional(),
})

export type LegacyPlanCreateExtras = Partial<Omit<CreatePlanBody, 'teamId' | 'title' | 'overview'>>

export function extractLegacyPlanCreateExtras(payload: unknown): LegacyPlanCreateExtras | null {
  const parsed = legacyPlanCreateExtrasSchema.safeParse(payload)

  if (!parsed.success) return null
  const extras = parsed.data
  const hasAny =
    (extras.decisions?.length ?? 0) > 0 ||
    (extras.steps?.length ?? 0) > 0 ||
    extras.costSummary !== undefined ||
    extras.costOneTime !== undefined ||
    extras.costMonthly !== undefined ||
    extras.costSavings !== undefined ||
    extras.riskWorstCase !== undefined ||
    (extras.riskMitigations?.length ?? 0) > 0

  if (!hasAny) return null

  return {
    decisions: extras.decisions?.slice(0, PLAN_LIMITS.decisions).map((decision) => ({
      label: truncatePlanText(decision.label, PLAN_LIMITS.decisionLabel),
      value: truncatePlanText(decision.value, PLAN_LIMITS.decisionValue),
    })),
    steps: extras.steps?.slice(0, PLAN_LIMITS.steps).map((step) =>
      normalizeAgentPlanStep({
        ...step,
        title: step.title ?? step.jobs[0]?.title ?? 'Untitled step',
      }),
    ),
    costSummary: truncateOptionalPlanText(extras.costSummary, PLAN_LIMITS.costSummary),
    costOneTime: truncateOptionalPlanText(extras.costOneTime, PLAN_LIMITS.costDetail),
    costMonthly: truncateOptionalPlanText(extras.costMonthly, PLAN_LIMITS.costDetail),
    costSavings: truncateOptionalPlanText(extras.costSavings, PLAN_LIMITS.costDetail),
    riskWorstCase: truncateOptionalPlanText(extras.riskWorstCase, PLAN_LIMITS.riskWorstCase),
    riskMitigations: extras.riskMitigations
      ?.slice(0, PLAN_LIMITS.riskMitigations)
      .map((mitigation) => truncatePlanText(mitigation, PLAN_LIMITS.riskMitigation)),
  }
}
