import { isDeepStrictEqual } from 'node:util'

import { isValidCronExpression } from '@/lib/cron'
import { AppError } from '@/lib/errors'
import { clearSlackNotificationIncidentsForTrigger } from '@/lib/slack/incident-notifications'

import {
  assertTriggerAccess,
  assertTriggerExecutionMutationAccess,
  triggerExecutionPrincipalId,
} from '../trigger-access'
import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { scheduleCronTrigger, unscheduleCronTrigger } from '../trigger-scheduler'
import { assertTriggerSlackDestinationAuthorized } from '../trigger-slack-authorization'

import {
  findManagedTrigger,
  parseTriggerId,
  serializeTrigger,
  validateIncidentConfiguration,
  validateMinInterval,
  validateSlackDestination,
} from './shared'
import { rollbackTriggerUpdate } from './update-rollback'

import type { TriggerActor } from '../trigger-access'
import type { AgentTrigger } from '../trigger-db'
import type { SerializedTrigger, UpdateTriggerPatch } from './shared'
import type { UpdateFilter } from 'mongodb'

/**
 * Patch name / messageTemplate / enabled / cronExpression. The MongoDB write
 * owns the cleanup/revision fence; scheduler and incident side effects run
 * only after it succeeds and the row is rolled back if reconciliation fails.
 */
export async function updateTrigger(
  triggerId: string,
  actor: TriggerActor,
  patch: UpdateTriggerPatch,
): Promise<SerializedTrigger> {
  const _id = parseTriggerId(triggerId)
  const trigger = await findManagedTrigger(_id)

  await assertTriggerAccess(trigger, actor, 'manage')
  if (trigger.cleanupStatus) {
    throw new AppError(
      409,
      'trigger_cleanup_pending',
      trigger.cleanupStatus === 'deleting'
        ? 'This Watch is being removed'
        : 'This Watch is disabled until provider cleanup is retried',
    )
  }

  const nextName =
    typeof patch.name === 'string' && patch.name.trim()
      ? patch.name.trim().slice(0, 100)
      : trigger.name
  const nextMessageTemplate =
    typeof patch.messageTemplate === 'string' && patch.messageTemplate.trim()
      ? patch.messageTemplate.trim()
      : trigger.messageTemplate
  const nextEnabled = typeof patch.enabled === 'boolean' ? patch.enabled : trigger.enabled

  if (patch.minIntervalSeconds !== undefined) {
    validateMinInterval(trigger.triggerType, patch.minIntervalSeconds)
  }
  if (patch.incidentMode !== undefined) {
    if (trigger.triggerType !== 'webhook') {
      throw new AppError(
        400,
        'invalid_incident_mode',
        'incidentMode is only valid for webhook triggers',
      )
    }
  }
  if (patch.slackDestination) {
    validateSlackDestination(patch.slackDestination)
  }

  const nextIncidentMode = patch.incidentMode ?? trigger.incidentMode
  const nextSlackDestination =
    patch.incidentMode === false || patch.slackDestination === null
      ? undefined
      : (patch.slackDestination ?? trigger.slackDestination)

  validateIncidentConfiguration({
    triggerType: trigger.triggerType,
    ...(nextIncidentMode !== undefined ? { incidentMode: nextIncidentMode } : {}),
    ...(nextSlackDestination ? { slackDestination: nextSlackDestination } : {}),
  })
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
  const minIntervalChanged =
    patch.minIntervalSeconds !== undefined &&
    patch.minIntervalSeconds !== trigger.minIntervalSeconds
  const slackDestinationChanged = !isDeepStrictEqual(nextSlackDestination, trigger.slackDestination)
  const enabledChanged = nextEnabled !== trigger.enabled
  const incidentModeChanged = nextIncidentMode !== trigger.incidentMode
  const substantiveChanged =
    messageTemplateChanged ||
    cronChanged ||
    minIntervalChanged ||
    incidentModeChanged ||
    slackDestinationChanged

  // An edit changes what the Trigger does, never who it runs as. Editing is
  // still gated on outranking the principal, because until the identity moves
  // the editor's instructions execute with the principal's authority — but the
  // identity itself only moves through the explicit Admin transfer below, so
  // no edit can promote a Trigger to its editor's permissions.
  if (substantiveChanged) {
    await assertTriggerExecutionMutationAccess(trigger, actor)
  }

  const principalUserId = triggerExecutionPrincipalId(trigger)

  if (
    nextIncidentMode === true &&
    nextSlackDestination &&
    (slackDestinationChanged || incidentModeChanged || enabledChanged || substantiveChanged)
  ) {
    await assertTriggerSlackDestinationAuthorized(nextSlackDestination, {
      teamId: trigger.teamId,
      userId: principalUserId,
    })
  }

  if (!nameChanged && !enabledChanged && !substantiveChanged) {
    return serializeTrigger(trigger)
  }

  const $set: Partial<AgentTrigger> & { updatedAt: Date } = {
    updatedAt: new Date(),
    ...(nameChanged ? { name: nextName } : {}),
    ...(messageTemplateChanged ? { messageTemplate: nextMessageTemplate } : {}),
    ...(enabledChanged ? { enabled: nextEnabled } : {}),
    ...(cronChanged && nextCronExpression ? { cronExpression: nextCronExpression } : {}),
    ...(minIntervalChanged ? { minIntervalSeconds: patch.minIntervalSeconds } : {}),
    ...(incidentModeChanged ? { incidentMode: nextIncidentMode } : {}),
    ...(slackDestinationChanged && nextSlackDestination
      ? { slackDestination: nextSlackDestination }
      : {}),
  }
  const currentConfigRevision = trigger.configRevision ?? 0
  const updated: AgentTrigger = {
    ...trigger,
    ...$set,
    configRevision: currentConfigRevision + 1,
  }

  if (patch.incidentMode === false || patch.slackDestination === null) {
    delete updated.slackDestination
  }

  const resetIncidentLifecycle =
    trigger.incidentMode === true &&
    (patch.enabled === false ||
      patch.incidentMode === false ||
      messageTemplateChanged ||
      slackDestinationChanged)

  // Re-assert ownership, revision, and cleanup state in the same write. This
  // prevents an update that raced a deletion claim from mutating the Watch.
  const update: UpdateFilter<AgentTrigger> = { $set }
  const $unset: Record<string, true> = {}

  if (patch.incidentMode === false || patch.slackDestination === null) {
    $unset.slackDestination = true
  }
  if (Object.keys($unset).length > 0) {
    update.$unset = $unset
  }
  update.$inc = { configRevision: 1 }
  const writeResult = await agentTriggers().updateOne(
    {
      _id,
      cleanupStatus: { $exists: false },
      ...triggerConfigRevisionFilter(currentConfigRevision),
    },
    update,
  )

  if (writeResult.matchedCount === 0) {
    const current = await agentTriggers().findOne({ _id })

    if (current?.cleanupStatus) {
      throw new AppError(409, 'trigger_cleanup_pending', 'This Watch is being removed')
    }
    throw new AppError(
      current ? 409 : 404,
      current ? 'trigger_changed' : 'not_found',
      current
        ? 'Trigger configuration changed concurrently; reload it and retry'
        : 'Trigger not found',
    )
  }

  const reconcileCron = trigger.triggerType === 'cron' && (cronChanged || enabledChanged)

  try {
    if (reconcileCron) {
      const expression = updated.cronExpression

      if (updated.enabled && expression) await scheduleCronTrigger(triggerId, expression)
      else await unscheduleCronTrigger(triggerId)

      // If deletion claimed the row while BullMQ was updating, delete wins:
      // remove any schedule this call may just have created.
      const stillCurrent = await agentTriggers().findOne(
        {
          _id,
          cleanupStatus: { $exists: false },
          ...triggerConfigRevisionFilter(currentConfigRevision + 1),
        },
        { projection: { _id: 1 } },
      )

      if (!stillCurrent) {
        await unscheduleCronTrigger(triggerId)
        throw new AppError(409, 'trigger_cleanup_pending', 'This Watch is being removed')
      }
    }
    if (resetIncidentLifecycle) {
      await clearSlackNotificationIncidentsForTrigger(triggerId, trigger.teamId)
    }
  } catch (err) {
    await rollbackTriggerUpdate({ _id, triggerId, trigger, currentConfigRevision, reconcileCron })
    throw err
  }

  return serializeTrigger(updated)
}
