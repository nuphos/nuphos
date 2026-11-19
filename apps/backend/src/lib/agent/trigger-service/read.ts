import { nextCronRuns } from '@/lib/cron'
import { logError, logEvent } from '@/lib/observability'

import { getConversationBySessionId } from '../db'
import { readsConversation } from '../db/access'
import { assertTeamMember, assertTriggerAccess, canManageTrigger } from '../trigger-access'
import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { unscheduleCronTrigger } from '../trigger-scheduler'

import { triggerListFilter } from './list-filter'
import { triggerScheduleDescription } from './schedule-description'
import { findManagedTrigger, parseTriggerId, serializeTrigger } from './shared'

import type { TriggerActor } from '../trigger-access'
import type { SerializedTrigger } from './shared'

export async function listTriggers(
  scope: {
    userId: string
    teamId?: string
  },
  targetSessionId?: string,
) {
  if (scope.teamId) await assertTeamMember(scope)
  if (scope.teamId && targetSessionId) {
    const conversation = await getConversationBySessionId(targetSessionId)

    if (conversation?.teamId !== scope.teamId || !readsConversation(conversation, scope.userId)) {
      return []
    }
  }
  const rows = await agentTriggers()
    .find(triggerListFilter(scope, targetSessionId))
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray()

  return rows.map((trigger) => {
    const owns = canManageTrigger(trigger, scope.userId)

    return {
      ...serializeTrigger(trigger),
      scheduleDescription: triggerScheduleDescription(trigger),
      canManage: owns,
      canDelete: owns,
      nextRunAt:
        trigger.enabled && trigger.triggerType === 'cron' && trigger.cronExpression
          ? (nextCronRuns(trigger.cronExpression, 1, trigger.timeZone)[0] ?? null)
          : null,
    }
  })
}

/** The single-trigger view exposes the webhook secret only to an authorized manager. */
export async function getTrigger(
  triggerId: string,
  actor: TriggerActor,
): Promise<SerializedTrigger & { canManage: boolean }> {
  const trigger = await findManagedTrigger(parseTriggerId(triggerId))

  await assertTriggerAccess(trigger, actor, 'read')
  const exposeSecret = canManageTrigger(trigger, typeof actor === 'string' ? actor : actor.userId)

  return {
    ...serializeTrigger(trigger, exposeSecret),
    // As in the list, so a card shows its switch only to whoever may flip it.
    canManage: exposeSecret,
  }
}

/**
 * Expiry sweep: disable enabled triggers whose expiresAt has passed and pull
 * their cron schedules. Idempotent; invoked hourly by the trigger scheduler.
 */
export async function expireTriggers(now = new Date()): Promise<number> {
  const expired = await agentTriggers()
    .find({ enabled: true, expiresAt: { $lte: now } })
    .toArray()

  for (const trigger of expired) {
    if (!trigger._id) continue
    const triggerId = trigger._id.toString()

    await agentTriggers().updateOne(
      {
        _id: trigger._id,
        enabled: true,
        ...triggerConfigRevisionFilter(trigger.configRevision ?? 0),
      },
      { $set: { enabled: false, updatedAt: now }, $inc: { configRevision: 1 } },
    )
    if (trigger.triggerType === 'cron') {
      await unscheduleCronTrigger(triggerId).catch((err: unknown) => {
        logError('agent.trigger.expiry_unschedule_failed', err, { trigger_id: triggerId })
      })
    }
    logEvent('info', 'agent.trigger.expired', {
      trigger_id: triggerId,
      trigger_name: trigger.name,
      source: trigger.source ?? 'user',
    })
  }

  return expired.length
}
