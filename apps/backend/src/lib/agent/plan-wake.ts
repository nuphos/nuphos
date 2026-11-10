// A plan decided without a turn of its own conversation (the Plans page, a
// teammate's final vote) wakes that conversation once, so no client has to
// send a "please proceed" turn. Answering the plan's question is already a
// turn, so that path never comes here.
import { getConversationBySessionId } from '@/lib/agent/db'
import { systemSender } from '@/lib/agent/message-metadata'
import { resumeSlackThreadForApprovedPlan } from '@/lib/agent/plan-slack-resume'

import type { PlanDTO } from '@/lib/agent/plans'

export async function wakeForPlanDecision(
  plan: Pick<
    PlanDTO,
    'number' | 'title' | 'sourceConversationId' | 'approvedAt' | 'rejectedAt' | 'updatedAt'
  >,
  decision: 'approved' | 'rejected',
  deciderUserId: string,
): Promise<void> {
  const sessionId = plan.sourceConversationId

  if (!sessionId) return
  const planId = String(plan.number)
  const title = plan.title || 'plan'

  // A Slack thread is the only place its plan can run.
  if (
    decision === 'approved' &&
    (await resumeSlackThreadForApprovedPlan({
      sessionId,
      planId,
      planTitle: title,
      approverNuphosUserId: deciderUserId,
    }))
  )
    return
  const decidedAt = (decision === 'approved' ? plan.approvedAt : plan.rejectedAt) ?? plan.updatedAt
  const conversation = await getConversationBySessionId(sessionId)

  if (!conversation) return
  const { startConversationTurn } = await import('./conversation-turn')

  const { run } = await startConversationTurn(
    {
      userId: conversation.userId,
      teamId: conversation.teamId ?? '',
      targetSessionId: sessionId,
      // One wake per decision, however often it is reported. A retried plan
      // decided again gets a new time, so it wakes again.
      messageId: `plan-${planId}-${decision}-${String(Date.parse(decidedAt))}`,
      locale: conversation.metadata?.locale ?? 'en-US',
    },
    conversation,
    decision === 'approved'
      ? `Plan #${planId} (${title}) was approved. Confirm it with get.sh, then execute it.`
      : `Plan #${planId} (${title}) was rejected. Discard it and stop.`,
    'agent.resource',
    systemSender('nuphos:plans', 'Nuphos'),
  )

  await run
}
