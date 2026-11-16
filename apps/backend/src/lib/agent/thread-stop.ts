import { logEvent } from '@/lib/observability'

import { listPendingUserMessages, takePendingUserMessages } from './pending-queue'
import { authorizeThreadDelivery } from './thread-bridge'

import type { ThreadActor } from './thread-bridge'

/**
 * Stop another conversation the actor owns, as its own Stop button does. The
 * messages agents queued for it go first, or the stop would only start the
 * next of them; messages people sent stay.
 */
export async function stopAgentThread(actor: ThreadActor, threadId: string) {
  const { target } = await authorizeThreadDelivery({ ...actor, targetSessionId: threadId })
  const queued = await listPendingUserMessages(target.userId, threadId)
  const dropped = await takePendingUserMessages(
    target.userId,
    threadId,
    queued.filter((message) => message.source === 'agent.thread'),
  )
  // Lazy so importing the tools does not pull in the route graph.
  const { stopConversationTurn } = await import('@/routes/agent/run-cancel')

  await stopConversationTurn(target)
  logEvent('info', 'agent.runtime.cancel_requested', {
    auth_source: 'agent_tool',
    user_id: actor.userId,
    team_id: actor.teamId,
    source_session_id: actor.sessionId,
    session_id: threadId,
    runtime_id: target.runtimeId,
    dropped_queued_messages: dropped.length,
  })

  return {
    threadId,
    status: 'stopped',
    droppedQueuedMessages: dropped.length,
    _links: { web: `/teams/${actor.teamId}/agent/${threadId}` },
  }
}
