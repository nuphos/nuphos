import { resolvePlanInputRequests } from '@/lib/agent/db'

import { plans } from './collections'
import { parsePlanNumber, scopedNumberFilter } from './scope'
import { serializePlan } from './serialize'

import type { PlanScope } from './scope'
import type { PlanDTO } from './serialize'

/**
 * Ends a Plan before it runs: rejected while it awaits a decision, cancelled
 * until it starts. Null when it is missing or already past that point, so a
 * racing decision cannot overwrite the first one.
 */
export async function closePlan(
  id: string,
  close: { status: 'rejected'; rejectedBy: string } | { status: 'cancelled' },
  scope: PlanScope,
): Promise<PlanDTO | null> {
  const planNumber = parsePlanNumber(id)

  if (planNumber == null) return null
  const now = new Date()
  const row = await plans().findOneAndUpdate(
    {
      ...scopedNumberFilter(planNumber, scope),
      status: close.status === 'rejected' ? 'proposed' : { $in: ['proposed', 'approved'] },
    },
    {
      $set:
        close.status === 'rejected'
          ? { ...close, rejectedAt: now, updatedAt: now }
          : { status: close.status, updatedAt: now },
    },
    { returnDocument: 'after' },
  )

  if (!row) return null
  const plan = serializePlan(row)

  if (plan.sourceConversationId) await resolvePlanInputRequests(plan.sourceConversationId, plan.id)

  return plan
}
