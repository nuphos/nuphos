import { PLAN_LIMITS } from './core-schemas'

import type {
  AgentAddPlanStepInput,
  AgentCreatePlanInput,
  AgentEditPlanStepInput,
  AgentSetPlanCostInput,
  AgentSetPlanDecisionsInput,
  AgentSetPlanMetaInput,
  AgentSetPlanRiskInput,
  agentPlanCreateStepSchema,
  agentPlanDecisionSchema,
} from './agent-schemas'
import type { CreatePlanBody } from './core-schemas'
import type { z } from 'zod'

export function truncatePlanText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return value.slice(0, maxLength)

  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

export function truncateOptionalPlanText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined

  return truncatePlanText(value, maxLength)
}

function normalizePlanCommand(command: string): string {
  if (command.length <= PLAN_LIMITS.command) return command

  return [
    'echo "Nuphos generated an oversized command for this plan. Ask the agent to split it into smaller commands before running." >&2',
    'exit 1',
  ].join('\n')
}

export function normalizeAgentCreatePlanInput(
  input: AgentCreatePlanInput,
): Pick<CreatePlanBody, 'title' | 'overview'> {
  return {
    title: truncatePlanText(input.title, PLAN_LIMITS.title),
    overview: truncateOptionalPlanText(input.overview, PLAN_LIMITS.overview),
  }
}

export function normalizeAgentPlanDecisionsInput(
  input: AgentSetPlanDecisionsInput,
): AgentSetPlanDecisionsInput {
  return {
    planId: input.planId,
    decisions: input.decisions.slice(0, PLAN_LIMITS.decisions).map((decision) => ({
      label: truncatePlanText(decision.label, PLAN_LIMITS.decisionLabel),
      value: truncatePlanText(decision.value, PLAN_LIMITS.decisionValue),
    })),
  }
}

type AgentPlanStep = z.infer<typeof agentPlanCreateStepSchema>

export function normalizeAgentPlanStep(step: AgentPlanStep): AgentPlanStep {
  return {
    title: truncatePlanText(step.title, PLAN_LIMITS.stepTitle),
    description: truncateOptionalPlanText(step.description, PLAN_LIMITS.stepDescription),
    jobs: step.jobs.slice(0, PLAN_LIMITS.jobsPerStep).map((job) => ({
      title: truncatePlanText(job.title, PLAN_LIMITS.jobTitle),
      description: truncateOptionalPlanText(job.description, PLAN_LIMITS.jobDescription),
      commands: job.commands?.slice(0, PLAN_LIMITS.commandsPerJob).map((command) => ({
        command: normalizePlanCommand(command.command),
        description: truncateOptionalPlanText(
          command.command.length > PLAN_LIMITS.command
            ? 'Generated command exceeded the plan size limit; split it into smaller commands before running.'
            : command.description,
          PLAN_LIMITS.commandDescription,
        ),
      })),
    })),
  }
}

export function normalizeAgentPlanStepInput(input: AgentAddPlanStepInput): AgentAddPlanStepInput {
  return {
    planId: input.planId,
    step: normalizeAgentPlanStep(input.step),
    insertAt: input.insertAt,
  }
}

export function normalizeAgentPlanEditStepInput(
  input: AgentEditPlanStepInput,
): AgentEditPlanStepInput {
  return {
    planId: input.planId,
    stepIdx: input.stepIdx,
    step: normalizeAgentPlanStep(input.step),
  }
}

export function normalizeAgentPlanMetaInput(input: AgentSetPlanMetaInput): AgentSetPlanMetaInput {
  return {
    planId: input.planId,
    title: input.title === undefined ? undefined : truncatePlanText(input.title, PLAN_LIMITS.title),
    overview: truncateOptionalPlanText(input.overview, PLAN_LIMITS.overview),
  }
}

export function normalizeAgentPlanCostInput(input: AgentSetPlanCostInput): AgentSetPlanCostInput {
  return {
    planId: input.planId,
    costSummary: truncatePlanText(input.costSummary, PLAN_LIMITS.costSummary),
    costOneTime: truncateOptionalPlanText(input.costOneTime, PLAN_LIMITS.costDetail),
    costMonthly: truncateOptionalPlanText(input.costMonthly, PLAN_LIMITS.costDetail),
    costSavings: truncateOptionalPlanText(input.costSavings, PLAN_LIMITS.costDetail),
  }
}

export function normalizeAgentPlanRiskInput(input: AgentSetPlanRiskInput): AgentSetPlanRiskInput {
  return {
    planId: input.planId,
    riskWorstCase: truncatePlanText(input.riskWorstCase, PLAN_LIMITS.riskWorstCase),
    riskMitigations: input.riskMitigations
      .slice(0, PLAN_LIMITS.riskMitigations)
      .map((mitigation) => truncatePlanText(mitigation, PLAN_LIMITS.riskMitigation)),
  }
}

export function normalizeAgentFullPlanInput(
  input: AgentCreatePlanInput & {
    decisions?: z.infer<typeof agentPlanDecisionSchema>[]
    steps: z.infer<typeof agentPlanCreateStepSchema>[]
    costSummary: string
    costOneTime?: string
    costMonthly?: string
    costSavings?: string
    riskWorstCase: string
    riskMitigations: string[]
  },
): Omit<CreatePlanBody, 'teamId'> {
  return {
    ...normalizeAgentCreatePlanInput(input),
    decisions: input.decisions?.slice(0, PLAN_LIMITS.decisions).map((decision) => ({
      label: truncatePlanText(decision.label, PLAN_LIMITS.decisionLabel),
      value: truncatePlanText(decision.value, PLAN_LIMITS.decisionValue),
    })),
    steps: input.steps.slice(0, PLAN_LIMITS.steps).map(normalizeAgentPlanStep),
    costSummary: truncatePlanText(input.costSummary, PLAN_LIMITS.costSummary),
    costOneTime: truncateOptionalPlanText(input.costOneTime, PLAN_LIMITS.costDetail),
    costMonthly: truncateOptionalPlanText(input.costMonthly, PLAN_LIMITS.costDetail),
    costSavings: truncateOptionalPlanText(input.costSavings, PLAN_LIMITS.costDetail),
    riskWorstCase: truncatePlanText(input.riskWorstCase, PLAN_LIMITS.riskWorstCase),
    riskMitigations: input.riskMitigations
      .slice(0, PLAN_LIMITS.riskMitigations)
      .map((mitigation) => truncatePlanText(mitigation, PLAN_LIMITS.riskMitigation)),
  }
}
