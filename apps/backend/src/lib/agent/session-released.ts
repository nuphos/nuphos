import { isShuttingDown } from '@/lib/lifecycle'
import { logError } from '@/lib/observability'

import { hasPendingUserMessages, TRANSCRIPT_SOURCES } from './pending-messages'

type QueuedTurnStarter = (userId: string, sessionId: string) => Promise<void>

// Installed at boot: the run locks that call this must not import the turn graph.
let startQueuedTurn: QueuedTurnStarter | null = null

export function installQueuedTurnStarter(start: QueuedTurnStarter): void {
  startQueuedTurn = start
}

/**
 * A session's run or claim was let go. Whatever was queued behind it starts
 * the next turn. Both locks call this, and only the last one to go can claim.
 */
export function sessionReleased(userId: string, sessionId: string): void {
  const start = startQueuedTurn

  // A draining replica cannot start a run; the queue waits for the next turn.
  if (!start || isShuttingDown()) return
  void (async () => {
    if (await hasPendingUserMessages(userId, sessionId, userId, TRANSCRIPT_SOURCES)) {
      await start(userId, sessionId)
    }
  })().catch((error: unknown) => {
    logError('agent.pending_messages.queued_turn_failed', error, {
      user_id: userId,
      session_id: sessionId,
    })
  })
}
