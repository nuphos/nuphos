import { getTeamMembership } from '@/lib/identity'
import { nextCronRuns } from '@/lib/cron'
import { logError, logEvent } from '@/lib/observability'
import { clearSlackNotificationIncidentsForTrigger } from '@/lib/slack/incident-notifications'

import { assertTriggerAccess, canManageTrigger } from '../trigger-access'
import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { managedProviderResourcePlanForTrigger } from '../trigger-provider-resources'
import { unscheduleCronTrigger } from '../trigger-scheduler'

import { triggerListFilter } from './list-filter'
import { triggerScheduleDescription } from './schedule-description'
import { findManagedTrigger, parseTriggerId, serializeTrigger } from './shared'

import type { TriggerActor } from '../trigger-access'
import type { ManagedProviderResourcePlan } from '../trigger-provider-resources'
import type { SerializedTrigger } from './shared'

export async function listTriggers(
  scope: {
    userId: string
    teamId?: string
  },
  targetSessionId?: string,
) {
  const rows = await agentTriggers()
    .find(triggerListFilter(scope, targetSessionId))
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray()

  const canManage =
    rows.length > 0 &&
    (await canManageTrigger({ userId: scope.userId, teamId: scope.teamId }, scope))

  const canDelete = scope.teamId
    ? (await getTeamMembership(scope.userId, scope.teamId))?.role === 'ADMINISTRATOR'
    : true

  return rows.map((trigger) => ({
    ...serializeTrigger(trigger),
    scheduleDescription: triggerScheduleDescription(trigger),
    canManage: !trigger.cleanupStatus && canManage,
    canDelete,
    nextRunAt:
      trigger.enabled && trigger.triggerType === 'cron' && trigger.cronExpression
        ? (nextCronRuns(trigger.cronExpression, 1, trigger.timeZone)[0] ?? null)
        : null,
  }))
}

/** The single-trigger view exposes the webhook secret only to an authorized manager. */
export async function getTrigger(
  triggerId: string,
  actor: TriggerActor,
): Promise<SerializedTrigger & { managedProviderResources?: ManagedProviderResourcePlan }> {
  const trigger = await findManagedTrigger(parseTriggerId(triggerId))

  await assertTriggerAccess(trigger, actor, 'read')
  const exposeSecret = await canManageTrigger(trigger, actor)
  const managedProviderResources = await managedProviderResourcePlanForTrigger(trigger)

  return {
    ...serializeTrigger(trigger, exposeSecret),
    ...(managedProviderResources ? { managedProviderResources } : {}),
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

    if (trigger.incidentMode) {
      await clearSlackNotificationIncidentsForTrigger(triggerId, trigger.teamId)
    }
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
