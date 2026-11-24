import { restoreArchivedConversation } from '@/lib/agent/db'
import { logError, logEvent } from '@/lib/observability'

import type { AgentConversation } from '@/lib/agent/db'
import type { ArchiveActor } from '@/lib/agent/db/archive'
import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type { AgentSessionOrigin } from '@/lib/agent/message-origin'

type ArchivableConversation = Pick<AgentConversation, 'sessionId' | 'archivedAt'>

type Turn = { userId: string; origin?: AgentSessionOrigin; messages: { metadata?: unknown }[] }

/** Who a turn's restore is recorded for: its actor, and the agent or token that sent it. */
export function turnActor({ userId, origin, messages }: Turn): ArchiveActor {
  const metadata = messages.at(-1)?.metadata as Partial<MessageMetadata> | undefined
  const agentSessionId = metadata?.source === 'agent.thread' ? metadata.sourceSessionId : undefined

  return {
    source: origin === 'trigger' ? 'trigger' : 'turn',
    userId,
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(metadata?.cliTokenId ? { agentTokenId: metadata.cliTokenId } : {}),
  }
}

/** Best-effort: a failed restore must never cost the user their admitted turn. */
export async function restoreArchivedSession(
  sessionId: string,
  actor: ArchiveActor,
): Promise<void> {
  try {
    if (await restoreArchivedConversation(sessionId, actor)) {
      logEvent('info', 'agent.conversation.unarchived_by_turn', {
        session_id: sessionId,
        source: actor.source,
      })
    }
  } catch (err) {
    logError('agent.conversation.unarchive_by_turn_failed', err, { session_id: sessionId })
  }
}

/** Any turn brings an archived conversation back: a person's, an agent's or an event's. */
export async function restoreArchivedForTurn(
  conversation: ArchivableConversation | null | undefined,
  turn: Turn,
): Promise<void> {
  if (conversation?.archivedAt)
    await restoreArchivedSession(conversation.sessionId, turnActor(turn))
}
