import { getPlanApprovalProgress, plans } from '@/lib/agent/plans'
import { invalidateMongoCatalogCache } from '@/lib/database-catalog'
import { mongoChangeStatementDigest, runMongoDatabaseChange } from '@/lib/database-change'
import {
  claimMongoDatabasePlanExecution,
  finishMongoDatabasePlanExecutionWithRetry,
  planNumber,
} from '@/lib/database-change-plan/execution-store'
import { mongoDatabasePlanAction, mongoPlanChangeStatus } from '@/lib/database-change-plan/view'
import { canAccessDatabaseConnection, classifyDatabaseError } from '@/lib/database-connections'
import { decryptDatabaseCredential } from '@/lib/database-credentials'
import { resolveDatabaseNetwork } from '@/lib/database-network'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'

import type { Plan } from '@/lib/agent/plans'
import type { MongoDatabaseChangeStatement } from '@/lib/database-change'
import type { DatabaseConnection } from '@/models'

function directConnectionUri(connection: DatabaseConnection): string {
  if (!connection.encryptedCredential) {
    throw new AppError(
      422,
      'database_provider_operation_unavailable',
      'Provider-managed databases do not expose a direct credential.',
    )
  }

  return decryptDatabaseCredential(connection.encryptedCredential)
}

export async function executeMongoDatabasePlan(input: {
  connection: DatabaseConnection
  planId: string
  executorUserId: string
  idempotencyKey: string
}): Promise<Plan> {
  const number = planNumber(input.planId)

  if (number == null) {
    throw new AppError(404, 'database_change_not_found', 'Database change Plan not found.')
  }
  const load = async () => {
    const plan = await plans().findOne({
      teamId: input.connection.teamId.toHexString(),
      number,
    })
    const action = plan ? mongoDatabasePlanAction(plan, input.connection._id.toHexString()) : null

    if (!plan || !action) {
      throw new AppError(404, 'database_change_not_found', 'Database change Plan not found.')
    }

    return { plan, action }
  }

  let current = await load()

  if (current.action.executionId === input.idempotencyKey) return current.plan
  if (
    current.plan.status !== 'approved' ||
    !getPlanApprovalProgress(current.plan).satisfied ||
    mongoPlanChangeStatus(current.plan, current.action) === 'expired'
  ) {
    throw new AppError(
      409,
      'database_change_not_approved',
      'The Plan approval policy, expiry, or authorized executor requirement has not been satisfied.',
    )
  }
  if (!current.action.authorizedExecutorUserIds.includes(input.executorUserId)) {
    throw new AppError(
      403,
      'database_change_execution_denied',
      'You are not an authorized executor for this database Plan.',
    )
  }
  const members = await getTeamMembers(input.connection.teamId.toHexString())
  const executor = members.find((member) => member.id === input.executorUserId)

  if (
    !executor ||
    !canAccessDatabaseConnection(input.connection.access, executor.id, executor.role)
  ) {
    throw new AppError(
      403,
      'database_change_executor_access_denied',
      'The executor must remain an active team member with database access.',
    )
  }

  const claimed = await claimMongoDatabasePlanExecution({
    teamId: input.connection.teamId.toHexString(),
    planId: input.planId,
    actionId: current.action.id,
    executorUserId: input.executorUserId,
    idempotencyKey: input.idempotencyKey,
  })

  if (!claimed) {
    current = await load()
    if (current.action.executionId === input.idempotencyKey) return current.plan
    throw new AppError(
      409,
      'database_change_already_claimed',
      'This database Plan has already been claimed for execution.',
    )
  }

  let result: Awaited<ReturnType<typeof runMongoDatabaseChange>>

  try {
    const statement = JSON.parse(
      decryptDatabaseCredential(current.action.encryptedStatement),
    ) as MongoDatabaseChangeStatement

    if (mongoChangeStatementDigest(statement) !== current.action.statementDigest) {
      throw new AppError(
        409,
        'database_change_digest_mismatch',
        'The encrypted statement no longer matches the approved digest.',
      )
    }
    const network = await resolveDatabaseNetwork(
      input.connection.teamId,
      input.connection.networkMode,
      input.connection.tailscale,
    )

    result = await runMongoDatabaseChange(
      directConnectionUri(input.connection),
      statement,
      network.mongoOptions,
    )
  } catch (error) {
    const classified =
      error instanceof AppError
        ? { category: 'unknown' as const, message: error.message }
        : classifyDatabaseError(error)

    return finishMongoDatabasePlanExecutionWithRetry({
      teamId: input.connection.teamId.toHexString(),
      planId: input.planId,
      actionId: current.action.id,
      executorUserId: input.executorUserId,
      idempotencyKey: input.idempotencyKey,
      errorCategory: classified.category,
      errorMessage: classified.message,
    })
  }

  const finalized = await finishMongoDatabasePlanExecutionWithRetry({
    teamId: input.connection.teamId.toHexString(),
    planId: input.planId,
    actionId: current.action.id,
    executorUserId: input.executorUserId,
    idempotencyKey: input.idempotencyKey,
    result,
  })

  invalidateMongoCatalogCache(input.connection._id.toHexString())

  return finalized
}
