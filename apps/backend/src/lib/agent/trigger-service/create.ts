import { ObjectId } from 'mongodb'

import { isValidCronExpression } from '@/lib/cron'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { legacyMonitoringWatchDedupeKey, monitoringWatchDedupeKey } from '../monitoring-workflow'
import { assertTeamTriggerRole } from '../trigger-access'
import { agentTriggers, generateWebhookSecret } from '../trigger-db'
import { scheduleCronTrigger } from '../trigger-scheduler'
import { assertTriggerSlackDestinationAuthorized } from '../trigger-slack-authorization'

import { validateCreateTriggerShape } from './create-validation'
import { assertTriggerCreationQuota, resolveTriggerCredentialSelection } from './quota'
import {
  serializeTrigger,
  isDuplicateKeyError,
  validateIncidentConfiguration,
  validateMinInterval,
} from './shared'
import {
  assertDedupeCompatible,
  backfillMonitoringIdentity,
  findExistingWatch,
} from './watch-dedupe'

import type { AgentTrigger } from '../trigger-db'
import type { CreateTriggerInput, SerializedTrigger, TriggerCallerContext } from './shared'

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
  await assertTeamTriggerRole(ctx, 'manage')

  const name = input.name.trim().slice(0, 100)

  if (!name) throw new AppError(400, 'invalid_request', 'name is required')

  validateCreateTriggerShape(input)

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
  validateIncidentConfiguration(input)
  if (input.incidentMode === true && input.slackDestination) {
    await assertTriggerSlackDestinationAuthorized(input.slackDestination, ctx)
  }

  const dedupeKey = input.monitoringIdentity
    ? monitoringWatchDedupeKey(ctx.userId, ctx.teamId, input.monitoringIdentity)
    : input.dedupeKey
  const legacyDedupeKey = input.monitoringIdentity
    ? legacyMonitoringWatchDedupeKey(ctx.userId, ctx.teamId, input.monitoringIdentity)
    : null
  const acceptedDedupeKeys = [dedupeKey, legacyDedupeKey].filter((key): key is string =>
    Boolean(key),
  )

  // Idempotency: a dedupeKey that already exists returns the existing trigger
  // instead of erroring, so automation retries (re-fired incidents) are no-ops.
  if (dedupeKey) {
    const existing = await findExistingWatch({
      dedupeKey,
      legacyDedupeKey,
      teamId: ctx.teamId,
      monitoringIdentity: input.monitoringIdentity,
    })

    if (existing) {
      assertDedupeCompatible(existing, input, ctx, acceptedDedupeKeys)

      return serializeTrigger(
        await backfillMonitoringIdentity(existing, input.monitoringIdentity),
        true,
      )
    }
  }

  // Group partitions are implementation details; the Group service charges
  // exactly one quota slot before it creates any of them.
  if (!input.watchGroup) await assertTriggerCreationQuota(ctx)

  const now = new Date()
  const webhookSecret = input.triggerType === 'webhook' ? generateWebhookSecret() : undefined
  const credentials = await resolveTriggerCredentialSelection(ctx)

  const doc: Omit<AgentTrigger, '_id'> = {
    // Keep userId for backwards compatibility while making ownership and
    // execution identity explicit for all newly-created rows.
    userId: ctx.userId,
    createdByUserId: ctx.userId,
    executionPrincipalUserId: ctx.userId,
    ...credentials,
    executionAuthorizationStatus: 'unchecked',
    ...(ctx.teamId ? { teamId: ctx.teamId } : {}),
    name,
    triggerType: input.triggerType,
    ...(cronExpression ? { cronExpression } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
    messageTemplate,
    enabled: input.enabled ?? true,
    ...(ctx.source !== 'user' ? { source: ctx.source } : {}),
    ...(ctx.sourceContext ? { sourceContext: ctx.sourceContext } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
    ...(input.monitoringIdentity ? { monitoringIdentity: input.monitoringIdentity } : {}),
    ...(input.watchGroup
      ? {
          watchGroupId: new ObjectId(input.watchGroup.groupId),
          watchGroupPartitionKey: input.watchGroup.partitionKey,
          watchGroupMemberKeys: input.watchGroup.memberKeys,
        }
      : {}),
    // New rows are never legacy migration candidates. Only pre-existing rows
    // without this marker need startup inference from their original prompt.
    legacyProviderChecked: true,
    ...(input.minIntervalSeconds !== undefined
      ? { minIntervalSeconds: input.minIntervalSeconds }
      : {}),
    ...(input.incidentMode !== undefined ? { incidentMode: input.incidentMode } : {}),
    ...(input.slackDestination ? { slackDestination: input.slackDestination } : {}),
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
      const existing = await findExistingWatch({
        dedupeKey,
        legacyDedupeKey,
        teamId: ctx.teamId,
        monitoringIdentity: input.monitoringIdentity,
      })

      if (existing) {
        assertDedupeCompatible(existing, input, ctx, acceptedDedupeKeys)

        return serializeTrigger(
          await backfillMonitoringIdentity(existing, input.monitoringIdentity),
          true,
        )
      }
    }
    throw err
  }
  const triggerId = insertedId.toString()

  if (input.triggerType === 'cron' && cronExpression) {
    try {
      await scheduleCronTrigger(triggerId, cronExpression)
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
