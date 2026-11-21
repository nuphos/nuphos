import { ObjectId } from 'mongodb'

import { logError, logEvent } from '@/lib/observability'

import { agentTriggers } from './trigger-db'
import { fireTrigger } from './trigger-executor'
import { claimWindow } from './trigger-held-claim'

/** Fires what a Trigger held, once its window has ended. */
export async function flushHeldDeliveries(
  triggerId: string,
  waitAgain: (delayMs: number) => Promise<unknown>,
): Promise<void> {
  const trigger = await agentTriggers().findOne({ _id: new ObjectId(triggerId) })

  if (!trigger?.enabled || !trigger.heldDeliveries?.length) return
  const claim = await claimWindow(trigger)

  // A delivery claimed the window first and took what was held with it.
  if ('waitSeconds' in claim) {
    await waitAgain(claim.waitSeconds * 1000)

    return
  }
  const deliveries = (claim.payload as { coalesced?: number } | undefined)?.coalesced ?? 1

  logEvent('info', 'webhook.held_fired', { trigger_id: triggerId, deliveries })
  const { run } = await fireTrigger(trigger, claim.payload, { runKind: 'webhook' }).catch(
    (error: unknown) => {
      logError('webhook.held_lost', error, { trigger_id: triggerId, deliveries })

      throw error
    },
  )

  void run.catch((err: unknown) => {
    logError('webhook.trigger_execution_failed', err, { trigger_id: triggerId })
  })
}
