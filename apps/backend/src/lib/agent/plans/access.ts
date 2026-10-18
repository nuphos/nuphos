import { agentConversations } from '@/lib/agent/db'
import { canReply, conversationAccess } from '@/lib/agent/db/access'
import { AppError } from '@/lib/errors'

import type { PlanDTO } from './serialize'

// A plan shares its conversation's visibility: a plan from a conversation the
// caller cannot open answers 404, and changing one needs reply access there.
export async function assertPlanAccess(plan: PlanDTO, userId: string, need: 'read' | 'reply') {
  if (!plan.sourceConversationId) return
  const conversation = await agentConversations().findOne(
    { sessionId: plan.sourceConversationId },
    {
      projection: {
        userId: 1,
        teamId: 1,
        generalAccess: 1,
        participantIds: 1,
        viewOnlyIds: 1,
        managerIds: 1,
      },
    },
  )

  // No conversation left means nobody to protect, as in the team journal.
  if (!conversation) return
  const access = conversationAccess(conversation, userId)

  if (!access) throw new AppError(404, 'not_found', 'Plan not found')
  if (need === 'reply' && !canReply(access)) {
    throw new AppError(403, 'forbidden', 'You need reply access to this conversation')
  }
}
