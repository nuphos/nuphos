import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { clearSlackNotificationIncidentsForTrigger } from '@/lib/slack/incident-notifications'

import { assertTriggerAccess } from '../trigger-access'
import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { unscheduleCronTrigger } from '../trigger-scheduler'

import { parseTriggerId } from './shared'

import type { TriggerActor } from '../trigger-access'

/**
 * Remove a Trigger. Whatever calls a webhook Trigger's URL lives in that
 * provider and is not touched here.
 *
 * DELETE is idempotent: an already-removed Trigger is the requested final
 * state. The row goes first so a delivery that loaded it fails its re-check;
 * the schedule and incident state are then best-effort, since a leftover cron
 * job finds no row and the scheduler prunes it on the next start.
 */
export async function deleteTrigger(triggerId: string, actor: TriggerActor): Promise<void> {
  const _id = parseTriggerId(triggerId)
  const trigger = await agentTriggers().findOne({ _id })

  if (!trigger) return
  await assertTriggerAccess(trigger, actor, 'delete')

  const deleted = await agentTriggers().deleteOne({
    _id,
    ...triggerConfigRevisionFilter(trigger.configRevision ?? 0),
  })

  if (deleted.deletedCount === 0) {
    throw new AppError(409, 'trigger_changed', 'Trigger changed concurrently; reload it and retry')
  }
  if (trigger.triggerType === 'cron') {
    await unscheduleCronTrigger(triggerId).catch((err: unknown) => {
      logError('agent.trigger.delete_unschedule_failed', err, { trigger_id: triggerId })
    })
  }
  await clearSlackNotificationIncidentsForTrigger(triggerId, trigger.teamId).catch(
    (err: unknown) => {
      logError('agent.trigger.delete_incident_cleanup_failed', err, { trigger_id: triggerId })
    },
  )
}
