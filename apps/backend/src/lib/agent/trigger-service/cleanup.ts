import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'
import { clearSlackNotificationIncidentsForTrigger } from '@/lib/slack/incident-notifications'

import { agentTriggers } from '../trigger-db'
import {
  cleanupManagedProviderWiring,
  discoverLegacyProviderWiring,
} from '../trigger-provider-cleanup'

import { parseTriggerId } from './shared'
import { removeTriggerFromWatchGroups } from './watch-group-refs'

/** Queue worker entry point. It is idempotent and owns the actual provider mutation. */
export async function performTriggerCleanup(triggerId: string): Promise<void> {
  const _id = parseTriggerId(triggerId)
  const trigger = await agentTriggers().findOne({ _id })

  if (!trigger || trigger.cleanupStatus !== 'deleting') return

  try {
    const providerWiring =
      trigger.providerWiring ?? (await discoverLegacyProviderWiring(trigger, triggerId))

    if (providerWiring && !trigger.providerWiring) {
      await agentTriggers().updateOne(
        { _id, cleanupStatus: 'deleting' },
        { $set: { providerWiring, cleanupUpdatedAt: new Date() } },
      )
    }
    if (providerWiring) {
      await cleanupManagedProviderWiring(
        { ...trigger, enabled: false, providerWiring },
        triggerId,
        providerWiring,
      )
    }

    // Do not leave incident state behind if deletion reports success. A
    // provider failure above keeps both the local receipt and incident state
    // so retry has the complete lifecycle available.
    await clearSlackNotificationIncidentsForTrigger(triggerId, trigger.teamId)

    const deleted = await agentTriggers().deleteOne({ _id, cleanupStatus: 'deleting' })

    if (deleted.deletedCount === 0) {
      throw new AppError(
        409,
        'trigger_changed',
        'Trigger changed during cleanup; reload it and retry',
      )
    }
    if (trigger.watchGroupId) {
      // The trigger and provider resources are already gone at this point.
      // Group metadata is secondary bookkeeping, so a transient Mongo error
      // must not turn a completed deletion into a false failure. A later
      // idempotent retry will prune the same stale reference.
      await removeTriggerFromWatchGroups(
        _id,
        { ownerUserId: trigger.userId, teamId: trigger.teamId },
        {
          groupId: trigger.watchGroupId,
          memberKeys: trigger.watchGroupMemberKeys ?? [],
        },
      ).catch((err: unknown) => {
        logError('agent.trigger.group_reference_cleanup_failed', err, {
          trigger_id: triggerId,
          group_id: trigger.watchGroupId?.toString(),
        })
      })
    }
    logEvent('info', 'agent.trigger.provider_cleanup_completed', {
      trigger_id: triggerId,
      provider: providerWiring?.provider ?? 'local',
    })
  } catch (err) {
    const message =
      err instanceof AppError
        ? err.message
        : 'Provider cleanup failed. Retry after checking the connected integration.'

    await agentTriggers().updateOne(
      { _id, cleanupStatus: 'deleting' },
      {
        $set: {
          cleanupStatus: 'cleanup_failed',
          cleanupError: message.slice(0, 500),
          cleanupUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    )
    logError('agent.trigger.provider_cleanup_failed', err, {
      trigger_id: triggerId,
      provider: trigger.providerWiring?.provider ?? 'legacy_or_local',
    })
    if (err instanceof AppError) throw err
    throw new AppError(502, 'provider_cleanup_failed', message)
  }
}
