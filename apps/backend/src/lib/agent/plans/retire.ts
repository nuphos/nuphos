import { randomUUID } from 'node:crypto'

import { appendAutonomousConversationTurn, resolvePlanInputRequests } from '@/lib/agent/db'

import { plans } from './collections'

const RETIRED =
  'Plans were replaced by approval decisions, so this Plan was cancelled before it ran to completion.'

/**
 * Agents now ask for approval with a decision instead of a Plan, so a Plan left
 * open would wait forever. Cancels each one, clears its question from the Inbox
 * and tells its conversation why. Database changes keep their Plans. Idempotent.
 */
export async function cancelOpenAgentPlans(): Promise<number> {
  const open = await plans()
    .find({
      status: { $in: ['proposed', 'approved', 'executing'] },
      'actions.type': { $ne: 'mongodb.change' },
    })
    .toArray()
  let cancelled = 0

  for (const plan of open) {
    const result = await plans().updateOne(
      { _id: plan._id, status: plan.status },
      { $set: { status: 'cancelled', executionError: RETIRED, updatedAt: new Date() } },
    )

    if (result.modifiedCount === 0) continue
    cancelled++
    if (!plan.sourceConversationId) continue
    await resolvePlanInputRequests(plan.sourceConversationId, String(plan.number))
    if (!plan.teamId) continue
    await appendAutonomousConversationTurn({
      sessionId: plan.sourceConversationId,
      userId: plan.createdBy,
      teamId: plan.teamId,
      message: {
        id: randomUUID(),
        parts: [
          {
            type: 'text',
            text: `Plan #${String(plan.number)} "${plan.title}" was cancelled because Plans were replaced by approval decisions. Ask me to continue and I will request approval again before any risky change.`,
          },
        ],
      },
    })
  }

  return cancelled
}
