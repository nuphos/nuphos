import { observeSessionTurn } from '../../../lib/agentUnreadSessions.ts'

/** Only runtime transcript boundaries count; transport closure is not completion. */
export function observeTurnUnread(sessionId: string | undefined, event: Record<string, unknown>) {
  if (!sessionId || event.type !== 'sse' || !event.data || typeof event.data !== 'object') return
  const frame = event.data as Record<string, unknown>

  if (frame.type !== 'atlas-turn-complete' && frame.type !== 'atlas-turn-paused') return
  observeSessionTurn(sessionId)
}
