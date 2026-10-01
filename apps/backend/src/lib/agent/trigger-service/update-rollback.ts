import { logError } from '@/lib/observability'

import { agentTriggers, triggerConfigRevisionFilter } from '../trigger-db'
import { scheduleCronTrigger, unscheduleCronTrigger } from '../trigger-scheduler'

import type { AgentTrigger } from '../trigger-db'
import type { ObjectId } from 'mongodb'

export async function rollbackTriggerUpdate(input: {
  _id: ObjectId
  triggerId: string
  trigger: AgentTrigger
  currentConfigRevision: number
  reconcileCron: boolean
}): Promise<void> {
  const { _id, triggerId, trigger, currentConfigRevision, reconcileCron } = input
  // Revert only if nobody changed or claimed the row after our write.
  const rolledBack = await agentTriggers()
    .replaceOne(
      {
        _id,
        cleanupStatus: { $exists: false },
        ...triggerConfigRevisionFilter(currentConfigRevision + 1),
      },
      trigger,
    )
    .catch((rollbackError: unknown) => {
      logError('agent.trigger.update_rollback_failed', rollbackError, { trigger_id: triggerId })

      return null
    })

  if (rolledBack?.matchedCount && reconcileCron) {
    try {
      if (trigger.enabled && trigger.cronExpression) {
        await scheduleCronTrigger(triggerId, trigger.cronExpression)
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
