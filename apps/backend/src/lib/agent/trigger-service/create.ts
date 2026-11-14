import { isValidCronExpression } from '@/lib/cron'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { assertCanCreateTrigger } from '../trigger-access'
import { agentTriggers, generateWebhookSecret } from '../trigger-db'
import { scheduleCronTrigger } from '../trigger-scheduler'

import { validateCreateTriggerShape } from './create-validation'
import { assertTriggerCreationQuota, resolveTriggerCredentialSelection } from './quota'
import {
  assertBindableSession,
  serializeTrigger,
  isDuplicateKeyError,
  validateMinInterval,
} from './shared'

import type { AgentTrigger } from '../trigger-db'
import type { CreateTriggerInput, SerializedTrigger, TriggerCallerContext } from './shared'
import type { ObjectId } from 'mongodb'

/**
 * Create a trigger and (for cron) register it with the scheduler. Returns the
 * serialized trigger including the webhook secret — the only time it is
 * exposed on the create path. Rolls the insert back if the scheduler rejects
 * the cron registration so MongoDB never holds an enabled-but-unscheduled row.
 */
export async function createTrigger(
  input: CreateTriggerInput,
  ctx: TriggerCallerContext,
): Promise<SerializedTrigger> {
  // Keep the role check at the service boundary so HTTP, Agent tools, and
  // automation cannot disagree about who may create a team Trigger.
  await assertCanCreateTrigger(ctx)

  const name = input.name.trim().slice(0, 100)

  if (!name) throw new AppError(400, 'invalid_request', 'name is required')

  validateCreateTriggerShape(input)
  await assertBindableSession(input.targetSessionId, ctx.teamId, ctx.userId)

  const messageTemplate = input.messageTemplate.trim()

  if (!messageTemplate) throw new AppError(400, 'invalid_request', 'messageTemplate is required')

  let cronExpression: string | undefined

  if (input.triggerType === 'cron') {
    if (typeof input.cronExpression !== 'string' || !isValidCronExpression(input.cronExpression)) {
      throw new AppError(
        400,
        'invalid_request',
        'cronExpression must be a valid 5-field cron expression',
      )
    }
    cronExpression = input.cronExpression.trim()
  }

  if (
    input.expiresAt !== undefined &&
    !(input.expiresAt instanceof Date && !Number.isNaN(input.expiresAt.getTime()))
  ) {
    throw new AppError(400, 'invalid_request', 'expiresAt must be a valid date')
  }
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, 'invalid_request', 'expiresAt must be in the future')
  }
  if (input.minIntervalSeconds !== undefined)
    validateMinInterval(input.triggerType, input.minIntervalSeconds)

  const { dedupeKey } = input

  // Idempotency: a dedupeKey that already exists returns the existing trigger
  // instead of erroring, so automation retries are no-ops.
  if (dedupeKey) {
    const existing = await findDedupedTrigger(dedupeKey, input, ctx)

    if (existing) return serializeTrigger(existing, true)
  }

  if (input.enabled !== false) await assertTriggerCreationQuota(ctx)

  const now = new Date()
  const webhookSecret = input.triggerType === 'webhook' ? generateWebhookSecret() : undefined
  const credentials = await resolveTriggerCredentialSelection(ctx)

  const doc: Omit<AgentTrigger, '_id'> = {
    // Keep userId for backwards compatibility while making ownership and
    // execution identity explicit for all newly-created rows.
    userId: ctx.userId,
    ...credentials,
    executionAuthorizationStatus: 'unchecked',
    ...(ctx.teamId ? { teamId: ctx.teamId } : {}),
    name,
    triggerType: input.triggerType,
    ...(cronExpression ? { cronExpression } : {}),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
    targetSessionId: input.targetSessionId,
    messageTemplate,
    enabled: input.enabled ?? true,
    ...(ctx.source !== 'user' ? { source: ctx.source } : {}),
    ...(ctx.sourceContext ? { sourceContext: ctx.sourceContext } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
    ...(input.minIntervalSeconds !== undefined
      ? { minIntervalSeconds: input.minIntervalSeconds }
      : {}),
    configRevision: 1,
    createdAt: now,
    updatedAt: now,
  }

  let insertedId: ObjectId

  try {
    const result = await agentTriggers().insertOne(doc)

    insertedId = result.insertedId
  } catch (err) {
    // Lost the dedupe race to a concurrent creator — return theirs.
    if (dedupeKey && isDuplicateKeyError(err)) {
      const existing = await findDedupedTrigger(dedupeKey, input, ctx)

      if (existing) return serializeTrigger(existing, true)
    }
    throw err
  }
  const triggerId = insertedId.toString()

  if (input.triggerType === 'cron' && cronExpression && doc.enabled) {
    try {
      await scheduleCronTrigger(triggerId, cronExpression, input.timeZone)
    } catch (err) {
      // Roll back the insert so a scheduler failure doesn't leave an enabled
      // trigger in MongoDB that the cron worker never picks up.
      await agentTriggers()
        .deleteOne({ _id: insertedId })
        .catch((deleteErr: unknown) => {
          logError('agent.trigger.rollback_delete_failed', deleteErr, { trigger_id: triggerId })
        })
      throw err
    }
  }

  return serializeTrigger({ ...doc, _id: insertedId }, true)
}

/**
 * The trigger an earlier create with the same dedupeKey produced, or null. A
 * key reused for a different owner, type or conversation is a caller bug, not
 * a retry, so it conflicts instead of returning someone else's trigger.
 */
async function findDedupedTrigger(
  dedupeKey: string,
  input: CreateTriggerInput,
  ctx: TriggerCallerContext,
): Promise<AgentTrigger | null> {
  const existing = await agentTriggers().findOne({ dedupeKey })

  if (!existing) return null
  const sameOwner = ctx.teamId
    ? existing.teamId === ctx.teamId
    : existing.userId === ctx.userId && existing.teamId === undefined

  if (
    !sameOwner ||
    existing.triggerType !== input.triggerType ||
    existing.targetSessionId !== input.targetSessionId
  ) {
    throw new AppError(
      409,
      'trigger_dedupe_conflict',
      'That trigger idempotency key is already attached to a different trigger',
    )
  }

  return existing
}
