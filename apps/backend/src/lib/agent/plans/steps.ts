import type { PlanStep } from './types'

// Step shape accepted from callers — commands carry no status; storage stamps
// them `pending`.
export type PlanStepInput = {
  title: string
  description?: string
  jobs: {
    title: string
    description?: string
    commands?: { command: string; description?: string }[]
  }[]
}

export function buildPlanStepDoc(step: PlanStepInput): PlanStep {
  return {
    title: step.title,
    description: step.description,
    jobs: step.jobs.map((job) => ({
      title: job.title,
      description: job.description,
      commands: (job.commands ?? []).map((cmd) => ({
        command: cmd.command,
        description: cmd.description,
        status: 'pending' as const,
      })),
    })),
  }
}
