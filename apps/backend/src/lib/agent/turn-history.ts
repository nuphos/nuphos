import { logEvent } from '@/lib/observability'

import { getConversationWithMessages } from './db'

import type { PendingUserMessage } from './pending-messages'

/**
 * A turn's full history. It is read on every try, a refused queued turn retried
 * included, so each read logs what it cost.
 */
export async function readTurnHistory(
  {
    targetSessionId: sessionId,
    userId,
    teamId,
  }: { targetSessionId: string; userId: string; teamId: string },
  pending: PendingUserMessage[],
  source: string,
) {
  const heapBefore = process.memoryUsage().heapUsed
  const startedAt = performance.now()
  const history = await getConversationWithMessages(sessionId, userId, teamId)

  if (history)
    logEvent('info', 'agent.turn.history_loaded', {
      session_id: sessionId,
      message_count: history.messages.length,
      load_ms: Math.round(performance.now() - startedAt),
      heap_delta_bytes: process.memoryUsage().heapUsed - heapBefore,
      attempts: pending[0]?.attempts ?? 0,
      offline_since: pending[0]?.offlineSince,
      source,
    })

  return history
}
