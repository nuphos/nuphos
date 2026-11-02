import type { AgentConversation } from './db'
import type { PendingUserMessage } from './pending-messages'

type TurnEnd = (
  data: { userId: string; teamId: string; targetSessionId: string },
  target: AgentConversation,
  fresh: readonly Pick<PendingUserMessage, 'metadata'>[],
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

/** A turn ended: if a channel woke it, it answers there. */
export const channelTurnEnded: TurnEnd = async (data, target, fresh) => {
  await onEnd?.(data, target, fresh)
}
