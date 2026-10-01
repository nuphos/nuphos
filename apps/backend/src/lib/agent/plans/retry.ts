import { plans } from './collections'
import { parsePlanNumber, scopedNumberFilter } from './scope'
import { serializePlan } from './serialize'

import type { PlanScope } from './scope'
import type { PlanDTO } from './serialize'
import type { PlanJob, PlanStep } from './types'

export async function retryPlan(id: string, scope: PlanScope): Promise<PlanDTO | null> {
  const planNumber = parsePlanNumber(id)

  if (planNumber == null) return null
  const filter = scopedNumberFilter(planNumber, scope)
  const row = await plans().findOne(filter)

  if (!row) return null
  if (row.status !== 'failed') return serializePlan(row)
  // Database actions have their own immutable statement envelope and gateway
  // execution state. A generic retry would clear the Plan status without
  // resetting that envelope atomically, so retries remain a database-gateway
  // concern instead of falling back to Agent command execution.
  if (row.actions?.some((action) => action.type === 'mongodb.change')) {
    return serializePlan(row)
  }

  const resetSteps = row.steps.map<PlanStep>((step) => ({
    title: step.title,
    description: step.description,
    jobs: step.jobs.map<PlanJob>((job) => {
      const resetJob: PlanJob = {
        title: job.title,
        description: job.description,
      }

      if (job.commands) {
        resetJob.commands = job.commands.map((command) => ({
          command: command.command,
          description: command.description,
          status: 'pending' as const,
        }))
      }

      return resetJob
    }),
  }))
  const result = await plans().findOneAndUpdate(
    { ...filter, status: 'failed' },
    {
      $set: {
        status: 'proposed',
        steps: resetSteps,
        updatedAt: new Date(),
      },
      $unset: {
        approvals: '',
        approvedBy: '',
        approvedAt: '',
        rejectedBy: '',
        rejectedAt: '',
        executionStartedAt: '',
        executionFinishedAt: '',
        executionError: '',
      },
    },
    { returnDocument: 'after' },
  )

  return result ? serializePlan(result) : null
}
