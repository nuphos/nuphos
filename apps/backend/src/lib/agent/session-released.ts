import { isShuttingDown } from '@/lib/lifecycle'
import { logError } from '@/lib/observability'

import { hasQueuedTranscriptMessage } from './pending-queue'

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
    if (await hasQueuedTranscriptMessage(userId, sessionId)) {
      await start(userId, sessionId)
    }
  })().catch((error: unknown) => {
    logError('agent.pending_messages.queued_turn_failed', error, {
      user_id: userId,
      session_id: sessionId,
    })
  })
}

const RETRY_MS = 2_000
const retries = new Set<string>()

/**
 * The runtime is busy with work that holds no backend claim. Look again
 * shortly; the queue's own expiry bounds how long this keeps trying.
 */
export function retryQueuedTurn(userId: string, sessionId: string): void {
  const key = `${userId}:${sessionId}`

  if (retries.has(key)) return
  retries.add(key)
  setTimeout(() => {
    retries.delete(key)
    sessionReleased(userId, sessionId)
  }, RETRY_MS).unref()
}
