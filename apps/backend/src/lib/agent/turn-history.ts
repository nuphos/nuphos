import { logEvent } from '@/lib/observability'

import { agentMessages, getConversationWithMessages } from './db'

import type { PendingUserMessage } from './pending-messages'

// Enough for the turn's prompt and its trailing input; a long session holds tens of thousands.
export const TURN_HISTORY_TAIL = 200

/**
 * The pending messages a turn already ran: stored in the transcript. One a turn
 * took and handed back (`attempts`) was stored by that turn without running, so
 * it runs, whatever was stored after it. Read by id, never by walking the transcript.
 */
async function answeredIds(
  sessionId: string,
  userId: string,
  pending: PendingUserMessage[],
): Promise<Set<string>> {
  const ids = pending.filter((message) => !message.attempts).map((message) => message.id)

  if (ids.length === 0) return new Set()
  const stored = await agentMessages()
    .find({ userId, sessionId, messageId: { $in: ids } }, { projection: { messageId: 1 } })
    .toArray()

  return new Set(stored.map((message) => message.messageId))
}

/**
 * A turn's recent history and the pending messages already answered. Reads a
 * bounded tail: storing the turn appends, so the older messages are not needed.
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
  const history = await getConversationWithMessages(sessionId, userId, teamId, {
    tail: TURN_HISTORY_TAIL,
  })

  if (!history) return null
  const answered = await answeredIds(sessionId, history.conversation.userId, pending)

  logEvent('info', 'agent.turn.history_loaded', {
    session_id: sessionId,
    message_count: history.messages.length,
    load_ms: Math.round(performance.now() - startedAt),
    heap_delta_bytes: process.memoryUsage().heapUsed - heapBefore,
    attempts: pending[0]?.attempts ?? 0,
    offline_since: pending[0]?.offlineSince,
    source,
  })

  return { ...history, answered }
}
