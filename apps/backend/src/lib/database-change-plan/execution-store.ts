import { plans } from '@/lib/agent/plans'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import type { MongoDatabasePlanAction, Plan } from '@/lib/agent/plans'
import type { DatabaseErrorCategory } from '@/models'

export function planNumber(id: string): number | null {
  const value = Number(id)

  return Number.isInteger(value) && value > 0 ? value : null
}

export async function claimMongoDatabasePlanExecution(input: {
  teamId: string
  planId: string
  actionId: string
  executorUserId: string
  idempotencyKey: string
}): Promise<Plan | null> {
  const number = planNumber(input.planId)

  if (number == null) return null
  const now = new Date()

  return plans().findOneAndUpdate(
    {
      teamId: input.teamId,
      number,
      status: 'approved',
      actions: {
        $elemMatch: {
          id: input.actionId,
          type: 'mongodb.change',
          executionId: null,
          $or: [
            { expiresAt: null },
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: now } },
          ],
        },
      },
    },
    {
      $set: {
        status: 'executing',
        executionStartedAt: now,
        updatedAt: now,
        'actions.$[action].executionId': input.idempotencyKey,
        'actions.$[action].executionStartedAt': now,
      },
      $push: {
        'actions.$[action].events': {
          type: 'execution_started',
          actorUserId: input.executorUserId,
          at: now,
          comment: null,
        },
      },
    },
    { returnDocument: 'after', arrayFilters: [{ 'action.id': input.actionId }] },
  )
}

export async function finishMongoDatabasePlanExecution(input: {
  teamId: string
  planId: string
  actionId: string
  executorUserId: string
  idempotencyKey: string
  result?: Record<string, unknown>
  errorCategory?: DatabaseErrorCategory
  errorMessage?: string
}): Promise<Plan | null> {
  const number = planNumber(input.planId)

  if (number == null) return null
  const now = new Date()
  const succeeded = input.result !== undefined

  return plans().findOneAndUpdate(
    {
      teamId: input.teamId,
      number,
      status: 'executing',
      actions: { $elemMatch: { id: input.actionId, executionId: input.idempotencyKey } },
    },
    {
      $set: {
        status: succeeded ? 'completed' : 'failed',
        executionFinishedAt: now,
        ...(succeeded
          ? {}
          : { executionError: input.errorMessage ?? 'Database change execution failed.' }),
        updatedAt: now,
        'actions.$[action].executionCompletedAt': now,
        'actions.$[action].executionResult': input.result ?? null,
        'actions.$[action].executionErrorCategory': input.errorCategory ?? null,
        'actions.$[action].executionErrorMessage': input.errorMessage ?? null,
      },
      $push: {
        'actions.$[action].events': {
          type: succeeded ? 'execution_succeeded' : 'execution_failed',
          actorUserId: input.executorUserId,
          at: now,
          comment: input.errorMessage ?? null,
        },
      },
    },
    { returnDocument: 'after', arrayFilters: [{ 'action.id': input.actionId }] },
  )
}

async function finalizedMongoDatabasePlan(input: {
  teamId: string
  planId: string
  actionId: string
  idempotencyKey: string
  succeeded: boolean
}): Promise<Plan | null> {
  const number = planNumber(input.planId)

  if (number == null) return null
  const plan = await plans().findOne({ teamId: input.teamId, number })
  const action = plan?.actions?.find(
    (candidate): candidate is MongoDatabasePlanAction =>
      candidate.type === 'mongodb.change' && candidate.id === input.actionId,
  )

  if (
    !plan ||
    !action ||
    action.executionId !== input.idempotencyKey ||
    action.executionCompletedAt == null
  )
    return null
  if (input.succeeded ? plan.status !== 'completed' : plan.status !== 'failed') return null

  return plan
}

export async function finishMongoDatabasePlanExecutionWithRetry(
  input: Parameters<typeof finishMongoDatabasePlanExecution>[0],
): Promise<Plan> {
  const succeeded = input.result !== undefined
  let lastError: unknown = new Error(
    'Database Plan execution finalization did not match the claimed execution.',
  )

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const finalized = await finishMongoDatabasePlanExecution(input)

      if (finalized) return finalized
      const persisted = await finalizedMongoDatabasePlan({
        teamId: input.teamId,
        planId: input.planId,
        actionId: input.actionId,
        idempotencyKey: input.idempotencyKey,
        succeeded,
      })

      if (persisted) return persisted
      lastError = new Error(
        'Database Plan execution finalization no longer matches the claimed execution.',
      )
    } catch (error) {
      lastError = error
      // A MongoDB write can succeed even if its response is lost. Read the
      // immutable execution receipt before retrying so we do not misclassify
      // an already-finalized database mutation as failed.
      try {
        const persisted = await finalizedMongoDatabasePlan({
          teamId: input.teamId,
          planId: input.planId,
          actionId: input.actionId,
          idempotencyKey: input.idempotencyKey,
          succeeded,
        })

        if (persisted) return persisted
      } catch (verificationError) {
        lastError = verificationError
      }
    }

    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 100))
    }
  }

  logError('database.change_plan.finalization_failed', lastError, {
    plan_id: input.planId,
    action_id: input.actionId,
    succeeded,
  })
  throw new AppError(
    503,
    'database_change_finalization_failed',
    'The database operation finished, but Nuphos could not persist its final Plan status. Do not retry the mutation; reload the Plan and retry status reconciliation.',
  )
}
