import { isValidCommand } from '../planPayload'

import type { Plan } from '../../../api'
import type { PlanCommandStatus } from '../../../lib/planStepStatus'
import type { PlanCommand, PlanPayload } from '../planPayload'

export type CommandStatus = PlanCommandStatus

function planCommandsFromDb(commands: unknown): PlanCommand[] {
  const list = Array.isArray(commands) ? commands : [commands]

  return list.filter(isValidCommand).map((cmd) => ({
    command: cmd.command,
    description: cmd.description,
    stdout: cmd.stdout,
    stderr: cmd.stderr,
    exitCode: cmd.exitCode,
    executedBy: cmd.executedBy === 'agent' ? cmd.executedBy : undefined,
  }))
}

function planCommandStatusFromDb(status: unknown): CommandStatus {
  return status === 'running' || status === 'done' || status === 'failed' ? status : 'pending'
}

// ── DB plan → presentational shape ──────────────────────────────────────────
// A persisted Plan carries per-command status inline in its tree. The
// presentational PlanTool wants the static structure (payload) and a flat
// status array (progress) separately, so split them here. Single copy, shared
// by every surface that renders a plan (chat card, side pane, library).

export function planToPayload(plan: Plan): PlanPayload {
  return {
    title: plan.title,
    number: plan.number,
    overview: plan.overview,
    decisions: plan.decisions,
    databaseActions: plan.actions?.filter((action) => action.type === 'mongodb.change'),
    steps: plan.steps.map((step) => ({
      title: step.title,
      description: step.description,
      jobs: step.jobs.map((job) => ({
        title: job.title,
        description: job.description,
        commands: planCommandsFromDb(job.commands),
      })),
    })),
    cost: plan.costSummary
      ? {
          summary: plan.costSummary,
          oneTime: plan.costOneTime,
          monthly: plan.costMonthly,
          savings: plan.costSavings,
        }
      : undefined,
    risk: plan.riskWorstCase
      ? { worstCase: plan.riskWorstCase, mitigations: plan.riskMitigations ?? [] }
      : undefined,
  }
}

export function isPlanReadyForApproval(plan: Plan): boolean {
  const hasText = (value: string | undefined): boolean =>
    typeof value === 'string' && value.trim().length > 0

  return (
    plan.steps.length > 0 &&
    plan.steps.every((step) => step.jobs.length > 0) &&
    hasText(plan.costSummary) &&
    hasText(plan.riskWorstCase) &&
    (plan.riskMitigations?.some((item) => hasText(item)) ?? false)
  )
}

export function planToProgress(plan: Plan): CommandStatus[] {
  const out: CommandStatus[] = []

  for (const step of plan.steps) {
    for (const job of step.jobs) {
      const commands = Array.isArray(job.commands) ? job.commands : [job.commands]

      for (const cmd of commands) {
        if (!isValidCommand(cmd)) continue
        out.push(planCommandStatusFromDb((cmd as Record<string, unknown>).status))
      }
    }
  }

  return out
}
