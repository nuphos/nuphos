import { logError } from '@/lib/observability'

import type { AgentConversation } from './db'
import type { PendingUserMessage } from './pending-messages'

type TurnEnd = (
  data: { userId: string; teamId: string; targetSessionId: string },
  target: AgentConversation,
  fresh: readonly Pick<PendingUserMessage, 'id' | 'metadata'>[],
  completed: boolean,
) => Promise<void>

let onEnd: TurnEnd | undefined

/**
 * How a turn a channel woke answers there. channel-chat registers it: it starts
 * turns, so the turn code cannot import it back without the two depending on
 * each other.
 */
export function onChannelTurnEnd(handler: TurnEnd): void {
  onEnd = handler
}

/** A turn ended: if a channel woke it, it answers there. The reply is best effort and never fails the turn. */
export const channelTurnEnded: TurnEnd = async (data, target, fresh, completed) => {
  try {
    await onEnd?.(data, target, fresh, completed)
  } catch (error) {
    logError('agent.channel.reply_failed', error, { session_id: data.targetSessionId })
  }
}
