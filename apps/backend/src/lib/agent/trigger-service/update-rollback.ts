import { logError } from '@/lib/observability'

import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { writeTrigger } from '../trigger-history'
import { scheduleCronTrigger, unscheduleCronTrigger } from '../trigger-scheduler'

import type { AgentTrigger } from '../trigger-db'
import type { ObjectId } from 'mongodb'

export async function rollbackTriggerUpdate(input: {
  _id: ObjectId
  triggerId: string
  trigger: AgentTrigger
  /** What the update wrote, which this puts back to `trigger`. */
  updated: AgentTrigger
  currentConfigRevision: number
  reconcileCron: boolean
}): Promise<void> {
  const { _id, triggerId, trigger, updated, currentConfigRevision, reconcileCron } = input
  // Revert only if nobody changed or claimed the row after our write.
  const rolledBack = await writeTrigger(
    {
      before: updated,
      after: trigger,
      by: { actorId: 'system', via: 'rollback' },
      reason: 'Its schedule could not be updated',
    },
    async (session) =>
      (
        await agentTriggers().replaceOne(
          { _id, ...triggerConfigRevisionFilter(currentConfigRevision + 1) },
          trigger,
          { session },
        )
      ).matchedCount > 0,
  ).catch((rollbackError: unknown) => {
    logError('agent.trigger.update_rollback_failed', rollbackError, { trigger_id: triggerId })

    return false
  })

  if (rolledBack && reconcileCron) {
    try {
      if (trigger.enabled && trigger.cronExpression) {
        await scheduleCronTrigger(triggerId, trigger.cronExpression, trigger.timeZone)
      } else {
        await unscheduleCronTrigger(triggerId)
      }
    } catch (rollbackError) {
      logError('agent.trigger.scheduler_rollback_failed', rollbackError, {
        trigger_id: triggerId,
      })
    }
  }
}
