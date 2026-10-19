import {
  drainPendingUserMessages,
  enqueuePendingUserMessage,
  TRANSCRIPT_SOURCES,
} from '@/lib/agent/pending-messages'
import { hasQueuedTranscriptMessage } from '@/lib/agent/pending-queue'
import { activeRunForSession, claimAgentRunForSession } from '@/lib/agent/run-admission'
import { sessionReleased } from '@/lib/agent/session-released'
import { logEvent } from '@/lib/observability'

import type { PendingUserMessage } from '@/lib/agent/pending-messages'

export type ClaimOrEnqueueResult =
  | { mode: 'run'; release: () => void; carried: PendingUserMessage[] }
  | { mode: 'queued'; activeActorUserId?: string }
  // The caller must surface that this message could not be parked.
  | { mode: 'dropped' }

/**
 * Claims an idle session or hands a participant message to its live turn.
 * `carried` recovers messages when the previous turn ended during admission.
 */
export async function claimAgentRunOrEnqueue(args: {
  userId: string
  sessionId: string
  message: PendingUserMessage
  actorUserId?: string
}): Promise<ClaimOrEnqueueResult> {
  // A transcript message never overtakes one already waiting in the queue.
  const fifo = (TRANSCRIPT_SOURCES as readonly string[]).includes(args.message.source)
  const claim =
    fifo && (await hasQueuedTranscriptMessage(args.userId, args.sessionId))
      ? null
      : await claimAgentRunForSession(args.userId, args.sessionId)

  if (claim) return { mode: 'run', release: claim, carried: [] }
  const queuedMessage: PendingUserMessage = {
    ...args.message,
    actorUserId: args.message.actorUserId ?? args.actorUserId ?? args.userId,
  }
  const queued = await enqueuePendingUserMessage(args.userId, args.sessionId, queuedMessage)

  if (!queued) return { mode: 'dropped' }

  // The turn may have finished between the failed claim and the enqueue; then
  // nothing would drain the queue until its TTL.
  const activeAfterEnqueue = await activeRunForSession(args.userId, args.sessionId)

  if (activeAfterEnqueue) {
    return {
      mode: 'queued',
      ...(activeAfterEnqueue.actorUserId
        ? { activeActorUserId: activeAfterEnqueue.actorUserId }
        : {}),
    }
  }
  // The queue starts its head; ours runs in arrival order.
  if (fifo) {
    sessionReleased(args.userId, args.sessionId)

    return { mode: 'queued' }
  }
  const recovered = await claimAgentRunForSession(args.userId, args.sessionId)

  if (!recovered) return { mode: 'queued' }
  const carried = await drainPendingUserMessages(
    args.userId,
    args.sessionId,
    queuedMessage.actorUserId,
  )

  if (carried.length === 0) {
    // Another claimer drained first; nothing of ours is left to run.
    recovered()

    return { mode: 'queued' }
  }
  logEvent('info', 'agent.run.pending_messages_recovered', {
    user_id: args.userId,
    session_id: args.sessionId,
    recovered_count: carried.length,
  })

  return { mode: 'run', release: recovered, carried }
}
