import { logEvent } from '@/lib/observability'

import { agentTriggers } from './trigger-db'
import { HELD_DELIVERIES_MAX } from './trigger-held-claim'
import { enqueueHeldFlush } from './trigger-scheduler'

import type { AgentTrigger } from './trigger-db'

/**
 * Keeps a delivery that arrived inside the window and, if it starts a batch, schedules the fire
 * for when the window ends. One flush is pending per batch: a delivery joining a batch relies on
 * it, and one arriving just after a flush took the batch starts the next. The flush job is not
 * deduped by id, because an id still held by a running flush would swallow that next one.
 */
export async function holdDelivery(
  trigger: AgentTrigger,
  payload: unknown,
  waitSeconds: number,
): Promise<boolean> {
  const before = await agentTriggers().findOneAndUpdate(
    { _id: trigger._id },
    { $push: { heldDeliveries: { $each: [payload], $slice: -HELD_DELIVERIES_MAX } } },
    { returnDocument: 'before', projection: { heldDeliveries: 1 } },
  )
  const heldBefore = before?.heldDeliveries?.length ?? 0

  if (heldBefore >= HELD_DELIVERIES_MAX) {
    logEvent('warn', 'webhook.held_dropped', { trigger_id: String(trigger._id), kept: heldBefore })
  }
  if (heldBefore > 0) return true
  if (await enqueueHeldFlush(String(trigger._id), waitSeconds * 1000)) return true
  // Nothing will fire it: take it back and let the sender retry.
  await agentTriggers().updateOne({ _id: trigger._id }, { $pop: { heldDeliveries: 1 } })

  return false
}
