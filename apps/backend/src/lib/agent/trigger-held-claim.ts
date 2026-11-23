import { agentTriggers } from './trigger-db'

import type { AgentTrigger } from './trigger-db'

/** Deliveries kept for one window; past this the oldest are dropped, and the drop is visible. */
export const HELD_DELIVERIES_MAX = 20

/**
 * Opens the Trigger's `minIntervalSeconds` window for a fire now, or says how long until it
 * opens. When it opens, everything held while it was closed is taken, in arrival order, and
 * returned with `payload` (the delivery that claimed it, if any) as one payload to fire.
 */
export async function claimWindow(
  trigger: AgentTrigger,
  payload?: unknown,
): Promise<{ payload: unknown } | { waitSeconds: number }> {
  const cooldownSeconds = trigger.minIntervalSeconds ?? 0
  const now = new Date()
  const claimed = await agentTriggers().findOneAndUpdate(
    {
      _id: trigger._id,
      $or: [
        { lastRunAt: { $exists: false } },
        { lastRunAt: { $lte: new Date(now.getTime() - cooldownSeconds * 1000) } },
      ],
    },
    { $set: { lastRunAt: now }, $unset: { heldDeliveries: '' } },
    { returnDocument: 'before' },
  )

  if (!claimed) {
    const elapsed = trigger.lastRunAt ? (now.getTime() - trigger.lastRunAt.getTime()) / 1000 : 0

    return { waitSeconds: Math.max(1, Math.ceil(cooldownSeconds - elapsed)) }
  }
  const deliveries = [
    ...(claimed.heldDeliveries ?? []),
    ...(payload === undefined ? [] : [payload]),
  ]

  // One delivery goes as it came; several go together so the template sees them all.
  return {
    payload: deliveries.length > 1 ? { coalesced: deliveries.length, deliveries } : deliveries[0],
  }
}
