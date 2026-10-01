import { rollupPlanStatus } from '../../lib/planStepStatus'

import type { Plan } from '../../api'
import type { PlanStepStatus } from '../../lib/planStepStatus'
import type { TeamMember } from '../../types'

// A step with no commands counts as pending (no executable work yet).
function rollupStepStatus(step: Plan['steps'][number]): PlanStepStatus {
  const cmds = step.jobs.flatMap((j) => j.commands ?? [])

  return rollupPlanStatus(cmds.map((c) => c.status)) ?? 'pending'
}

export function stepProgress(plan: Plan): { done: number; failed: number; total: number } {
  const statuses = plan.steps.map(rollupStepStatus)

  return {
    total: statuses.length,
    done: statuses.filter((s) => s === 'done').length,
    failed: statuses.filter((s) => s === 'failed').length,
  }
}

export function memberDisplayName(member: TeamMember): string {
  return member.name || member.username || member.email
}

export function progressFraction(plan: Plan): number {
  const { done, total } = stepProgress(plan)

  if (total === 0) return 0

  return done / total
}
