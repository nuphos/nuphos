import { agentTriggers } from './trigger-db'
import { HELD_DELIVERIES_MAX } from './trigger-held-claim'
import { enqueueHeldFlush } from './trigger-scheduler'

import type { AgentTrigger } from './trigger-db'

/** Keeps a delivery that arrived inside the window and schedules the fire for when it ends. */
export async function holdDelivery(
  trigger: AgentTrigger,
  payload: unknown,
  waitSeconds: number,
): Promise<boolean> {
  if (!(await enqueueHeldFlush(String(trigger._id), waitSeconds * 1000))) return false
  await agentTriggers().updateOne(
    { _id: trigger._id },
    { $push: { heldDeliveries: { $each: [payload], $slice: -HELD_DELIVERIES_MAX } } },
  )

  return true
}
