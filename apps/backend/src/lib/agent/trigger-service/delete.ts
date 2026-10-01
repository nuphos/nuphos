import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { assertTriggerAccess } from '../trigger-access'
import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { isPotentialLegacyManagedWatch } from '../trigger-provider-cleanup'
import { scheduleTriggerCleanup, unscheduleCronTrigger } from '../trigger-scheduler'

import { performTriggerCleanup } from './cleanup'
import { parseTriggerId, serializeTrigger } from './shared'
import { removeTriggerFromWatchGroups } from './watch-group-refs'

import type { TriggerActor } from '../trigger-access'
import type { SerializedTrigger } from './shared'

export type DeleteTriggerResult = { deleted: true } | { deleted: false; trigger: SerializedTrigger }

export async function deleteTrigger(
  triggerId: string,
  actor: TriggerActor,
): Promise<DeleteTriggerResult> {
  const _id = parseTriggerId(triggerId)
  const trigger = await agentTriggers().findOne({ _id })

  if (!trigger) {
    // DELETE is intentionally idempotent. Provider cleanup may finish between
    // a list/detail read and a user's retry, so an already-removed trigger is
    // the requested final state rather than an error. Also prune a stale Group
    // partition left by an interrupted older cleanup.
    const actorScope =
      typeof actor === 'string'
        ? { ownerUserId: actor }
        : { ownerUserId: actor.userId, teamId: actor.teamId }

    await removeTriggerFromWatchGroups(_id, actorScope).catch((err: unknown) => {
      logError('agent.trigger.group_reference_cleanup_failed', err, {
        trigger_id: triggerId,
      })
    })

    return { deleted: true }
  }
  await assertTriggerAccess(trigger, actor, 'delete')

  if (trigger.cleanupStatus === 'deleting') {
    try {
      if (await scheduleTriggerCleanup(triggerId)) {
        return { deleted: false, trigger: serializeTrigger(trigger) }
      }
    } catch (err) {
      logError('agent.trigger.provider_cleanup_reenqueue_failed', err, { trigger_id: triggerId })
    }
    // Redis-disabled recovery after a process interruption.
    await performTriggerCleanup(triggerId)

    return { deleted: true }
  }

  // Fence every execution before touching provider state. A delivery that
  // loaded the old row must fail its enabled/revision re-check before Slack.
  const now = new Date()
  const currentRevision = trigger.configRevision ?? 0
  const legacyMonitoringProvider = trigger.legacyMonitoringProvider
  const claimed = await agentTriggers().updateOne(
    {
      _id,
      ...triggerConfigRevisionFilter(currentRevision),
      cleanupStatus:
        trigger.cleanupStatus === 'cleanup_failed' ? 'cleanup_failed' : { $exists: false },
    },
    {
      $set: {
        enabled: false,
        cleanupStatus: 'deleting',
        cleanupStartedAt: now,
        cleanupUpdatedAt: now,
        updatedAt: now,
      },
      $unset: { cleanupError: true },
      $inc: { configRevision: 1 },
    },
  )

  if (claimed.matchedCount === 0) {
    throw new AppError(409, 'trigger_changed', 'Trigger changed concurrently; reload it and retry')
  }

  logEvent('info', 'agent.trigger.provider_cleanup_requested', {
    trigger_id: triggerId,
    provider:
      trigger.providerWiring?.provider ??
      trigger.monitoringIdentity?.provider ??
      legacyMonitoringProvider ??
      'local',
  })

  if (trigger.triggerType === 'cron') await unscheduleCronTrigger(triggerId)

  // Ordinary cron/ad-hoc webhook triggers have no provider resource to wait
  // for; preserve the original immediate-delete behavior for them.
  const managedWatch =
    Boolean(trigger.providerWiring) ||
    Boolean(trigger.monitoringIdentity) ||
    isPotentialLegacyManagedWatch(trigger)

  if (!managedWatch) {
    await performTriggerCleanup(triggerId)

    return { deleted: true }
  }

  let scheduled = false

  try {
    scheduled = await scheduleTriggerCleanup(triggerId)
  } catch (err) {
    // Queue availability must not strand a claimed delete. The synchronous
    // path below uses the same persisted state and cleanup implementation.
    logError('agent.trigger.provider_cleanup_enqueue_failed', err, { trigger_id: triggerId })
  }
  if (scheduled) {
    return {
      deleted: false,
      trigger: serializeTrigger({
        ...trigger,
        enabled: false,
        cleanupStatus: 'deleting',
        cleanupStartedAt: now,
        cleanupUpdatedAt: now,
        updatedAt: now,
        configRevision: currentRevision + 1,
      }),
    }
  }

  await performTriggerCleanup(triggerId)

  return { deleted: true }
}
