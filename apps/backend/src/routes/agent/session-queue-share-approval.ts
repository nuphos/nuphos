// The owner's answer to a share approval stored before #1391 settles the sends that waited for it.
import { reportUndelivered } from '@/lib/agent/conversation-turn'
import { getConversationBySessionId } from '@/lib/agent/db'
import { listPendingUserMessages, takePendingUserMessages } from '@/lib/agent/pending-queue'
import { sessionReleased } from '@/lib/agent/session-released'
import { logEvent } from '@/lib/observability'

import type { ShareApproval } from '@/lib/agent/devices/local-share-store'

/**
 * The owner answered: an approval starts what waited; a refusal takes the
 * requester's waiting sends out of the queue, and keeps each in the
 * conversation with the reason, so the queue behind them can move.
 */
export async function settleShareApprovalQueue(approval: ShareApproval): Promise<void> {
  const conversation = await getConversationBySessionId(approval.sessionId)

  if (!conversation) return
  const { userId, sessionId } = conversation

  if (approval.status === 'approved') {
    sessionReleased(userId, sessionId)

    return
  }
  if (approval.status !== 'denied') return
  const waiting = (await listPendingUserMessages(userId, sessionId)).filter(
    (message) => message.chat && (message.actorUserId ?? userId) === approval.actorId,
  )
  const dropped = await takePendingUserMessages(userId, sessionId, waiting)

  if (dropped.length)
    logEvent('info', 'agent.pending_messages.share_declined_dropped', {
      user_id: userId,
      session_id: sessionId,
      message_ids: dropped.map((message) => message.id),
    })
  await reportUndelivered(
    { userId, teamId: conversation.teamId, targetSessionId: sessionId },
    dropped,
    'was not sent: the owner of the computer this conversation runs on declined to run it there. Move the conversation to another agent to continue.',
  )
}
