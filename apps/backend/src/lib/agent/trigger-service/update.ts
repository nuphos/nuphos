import { CRON_TIME_ZONE, isValidCronExpression, isValidTimeZone } from '@/lib/cron'
import { AppError } from '@/lib/errors'

import { assertTriggerAccess } from '../trigger-access'
import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { scheduleCronTrigger, unscheduleCronTrigger } from '../trigger-scheduler'

import { assertTriggerCreationQuota } from './quota'
import { findManagedTrigger, parseTriggerId, serializeTrigger, validateMinInterval } from './shared'
import { rollbackTriggerUpdate } from './update-rollback'

import type { TriggerActor } from '../trigger-access'
import type { AgentTrigger } from '../trigger-db'
import type { SerializedTrigger, UpdateTriggerPatch } from './shared'
import type { UpdateFilter } from 'mongodb'

/**
 * Patch name / messageTemplate / enabled / cronExpression. The MongoDB write
 * owns the revision fence; scheduler side effects run only after it succeeds
 * and the row is rolled back if reconciliation fails.
 */
export async function updateTrigger(
  triggerId: string,
  actor: TriggerActor,
  patch: UpdateTriggerPatch,
): Promise<SerializedTrigger> {
  const _id = parseTriggerId(triggerId)
  const trigger = await findManagedTrigger(_id)

  if (
    patch.timeZone !== undefined &&
    (trigger.triggerType !== 'cron' || !isValidTimeZone(patch.timeZone))
  )
    throw new AppError(400, 'invalid_request', 'timeZone must be an IANA zone for a cron Trigger')

  await assertTriggerAccess(trigger, actor, 'manage')

  const nextName =
    typeof patch.name === 'string' && patch.name.trim()
      ? patch.name.trim().slice(0, 100)
      : trigger.name
  const nextMessageTemplate =
    typeof patch.messageTemplate === 'string' && patch.messageTemplate.trim()
      ? patch.messageTemplate.trim()
      : trigger.messageTemplate
  const nextEnabled = typeof patch.enabled === 'boolean' ? patch.enabled : trigger.enabled

  // A row stored before Triggers needed a Task has nowhere to run; it stays off.
  if (nextEnabled && !trigger.targetSessionId) {
    throw new AppError(
      400,
      'trigger_target_session_required',
      'This Trigger has no Task to run in; create a new one in a Task instead',
    )
  }

  // Turning a Trigger back on takes a quota slot back, the same as creating one.
  if (nextEnabled && !trigger.enabled) {
    await assertTriggerCreationQuota({
      userId: trigger.userId,
      teamId: trigger.teamId,
    })
  }

  if (patch.minIntervalSeconds !== undefined) {
    validateMinInterval(trigger.triggerType, patch.minIntervalSeconds)
  }
  let nextCronExpression = trigger.cronExpression

  if (trigger.triggerType === 'cron' && typeof patch.cronExpression === 'string') {
    if (!isValidCronExpression(patch.cronExpression)) {
      throw new AppError(400, 'invalid_request', 'Invalid cronExpression')
    }
    nextCronExpression = patch.cronExpression.trim()
  }

  const nameChanged = nextName !== trigger.name
  const messageTemplateChanged = nextMessageTemplate !== trigger.messageTemplate
  const cronChanged = nextCronExpression !== trigger.cronExpression
  const nextTimeZone = patch.timeZone ?? trigger.timeZone ?? CRON_TIME_ZONE
  const timeZoneChanged = nextTimeZone !== (trigger.timeZone ?? CRON_TIME_ZONE)
  const minIntervalChanged =
    patch.minIntervalSeconds !== undefined &&
    patch.minIntervalSeconds !== trigger.minIntervalSeconds
  const enabledChanged = nextEnabled !== trigger.enabled
  const substantiveChanged =
    messageTemplateChanged || cronChanged || timeZoneChanged || minIntervalChanged

  if (!nameChanged && !enabledChanged && !substantiveChanged) {
    return serializeTrigger(trigger)
  }

  const $set: Partial<AgentTrigger> & { updatedAt: Date } = {
    updatedAt: new Date(),
    ...(nameChanged ? { name: nextName } : {}),
    ...(messageTemplateChanged ? { messageTemplate: nextMessageTemplate } : {}),
    ...(enabledChanged ? { enabled: nextEnabled } : {}),
    ...(cronChanged && nextCronExpression ? { cronExpression: nextCronExpression } : {}),
    ...(timeZoneChanged ? { timeZone: nextTimeZone } : {}),
    ...(minIntervalChanged ? { minIntervalSeconds: patch.minIntervalSeconds } : {}),
  }
  const currentConfigRevision = trigger.configRevision ?? 0
  const updated: AgentTrigger = {
    ...trigger,
    ...$set,
    configRevision: currentConfigRevision + 1,
  }

  // Re-assert the revision in the same write, so an update that raced another
  // edit or a deletion cannot apply on top of it.
  const update: UpdateFilter<AgentTrigger> = { $set }
  const $unset: Record<string, true> = {}

  // A missed-run marker belongs to the schedule it was raised for.
  if (cronChanged || timeZoneChanged || enabledChanged) $unset.missedRunAt = true
  if (Object.keys($unset).length > 0) {
    update.$unset = $unset
  }
  update.$inc = { configRevision: 1 }
  const writeResult = await agentTriggers().updateOne(
    { _id, ...triggerConfigRevisionFilter(currentConfigRevision) },
    update,
  )

  if (writeResult.matchedCount === 0) {
    const current = await agentTriggers().findOne({ _id })

    throw new AppError(
      current ? 409 : 404,
      current ? 'trigger_changed' : 'not_found',
      current
        ? 'Trigger configuration changed concurrently; reload it and retry'
        : 'Trigger not found',
    )
  }

  const reconcileCron =
    trigger.triggerType === 'cron' && (cronChanged || timeZoneChanged || enabledChanged)

  try {
    if (reconcileCron) {
      const expression = updated.cronExpression

      if (updated.enabled && expression)
        await scheduleCronTrigger(triggerId, expression, updated.timeZone)
      else await unscheduleCronTrigger(triggerId)

      // If the row was deleted or changed while BullMQ was updating, the
      // other write wins: remove any schedule this call may just have created.
      const stillCurrent = await agentTriggers().findOne(
        { _id, ...triggerConfigRevisionFilter(currentConfigRevision + 1) },
        { projection: { _id: 1 } },
      )

      if (!stillCurrent) {
        await unscheduleCronTrigger(triggerId)
        throw new AppError(
          409,
          'trigger_changed',
          'Trigger changed concurrently; reload it and retry',
        )
      }
    }
  } catch (err) {
    await rollbackTriggerUpdate({ _id, triggerId, trigger, currentConfigRevision, reconcileCron })
    throw err
  }

  return serializeTrigger(updated)
}
