import { CRON_TIME_ZONE, isValidCronExpression, isValidTimeZone } from '@/lib/cron'
import { AppError } from '@/lib/errors'
import { clearSlackNotificationIncidentsForTrigger } from '@/lib/slack/incident-notifications'

import {
  assertTriggerAccess,
  assertTriggerExecutionMutationAccess,
  triggerExecutionPrincipalId,
} from '../trigger-access'
import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { scheduleCronTrigger, unscheduleCronTrigger } from '../trigger-scheduler'

import { assertTriggerCreationQuota } from './quota'
import {
  assertBindableSession,
  findManagedTrigger,
  parseTriggerId,
  serializeTrigger,
  validateMinInterval,
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

  if (
    patch.timeZone !== undefined &&
    (trigger.triggerType !== 'cron' || !isValidTimeZone(patch.timeZone))
  )
    throw new AppError(400, 'invalid_request', 'timeZone must be an IANA zone for a cron Trigger')

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
  const nextTargetSessionId = patch.targetSessionId ?? trigger.targetSessionId

  // An unbound Trigger has nowhere to deliver. It can only be turned on together
  // with the conversation it delivers to, which is validated below.
  if (nextEnabled && !nextTargetSessionId) {
    throw new AppError(
      400,
      'trigger_target_session_required',
      'Choose the conversation this Trigger delivers to before enabling it',
    )
  }

  // Turning a Trigger back on takes a quota slot back, the same as creating one.
  if (nextEnabled && !trigger.enabled && !trigger.watchGroupId) {
    await assertTriggerCreationQuota({
      userId: trigger.createdByUserId ?? trigger.userId,
      teamId: trigger.teamId,
    })
  }

  const targetSessionChanged = nextTargetSessionId !== trigger.targetSessionId

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
    messageTemplateChanged ||
    cronChanged ||
    timeZoneChanged ||
    minIntervalChanged ||
    targetSessionChanged

  // An edit changes what the Trigger does, never who it runs as. Editing is
  // still gated on outranking the principal, because until the identity moves
  // the editor's instructions execute with the principal's authority — but the
  // identity itself only moves through the explicit Admin transfer below, so
  // no edit can promote a Trigger to its editor's permissions.
  if (substantiveChanged) {
    await assertTriggerExecutionMutationAccess(trigger, actor)
  }

  const principalUserId = triggerExecutionPrincipalId(trigger)

  if (targetSessionChanged && nextTargetSessionId) {
    // A bound fire runs with the session's own credentials, so only its owner may bind it.
    if ((typeof actor === 'string' ? actor : actor.userId) !== principalUserId) {
      throw new AppError(
        403,
        'invalid_target_session',
        'Only the Trigger owner can choose the session it delivers to',
      )
    }
    await assertBindableSession(nextTargetSessionId, trigger.teamId, principalUserId)
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
    ...(timeZoneChanged ? { timeZone: nextTimeZone } : {}),
    ...(minIntervalChanged ? { minIntervalSeconds: patch.minIntervalSeconds } : {}),
    ...(targetSessionChanged ? { targetSessionId: nextTargetSessionId } : {}),
  }
  const currentConfigRevision = trigger.configRevision ?? 0
  const updated: AgentTrigger = {
    ...trigger,
    ...$set,
    configRevision: currentConfigRevision + 1,
  }

  // A legacy Trigger created before binding was required leaves its
  // fresh-session modes behind the first time it is bound.
  const legacyModes =
    targetSessionChanged && !trigger.targetSessionId
      ? (['incidentMode', 'slackDestination', 'sessionRouting'] as const).filter(
          (field) => trigger[field] !== undefined,
        )
      : []

  for (const field of legacyModes) delete updated[field]

  const resetIncidentLifecycle =
    trigger.incidentMode === true &&
    (patch.enabled === false || messageTemplateChanged || legacyModes.length > 0)

  // Re-assert ownership, revision, and cleanup state in the same write. This
  // prevents an update that raced a deletion claim from mutating the Watch.
  const update: UpdateFilter<AgentTrigger> = { $set }
  const $unset: Record<string, true> = {}

  for (const field of legacyModes) $unset[field] = true
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

  const reconcileCron =
    trigger.triggerType === 'cron' && (cronChanged || timeZoneChanged || enabledChanged)

  try {
    if (reconcileCron) {
      const expression = updated.cronExpression

      if (updated.enabled && expression)
        await scheduleCronTrigger(triggerId, expression, updated.timeZone)
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
