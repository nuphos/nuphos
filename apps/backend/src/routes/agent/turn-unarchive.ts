import { restoreArchivedConversation } from '@/lib/agent/db'
import { logError, logEvent } from '@/lib/observability'

import type { AgentConversation } from '@/lib/agent/db'
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'

type ArchivableConversation = Pick<AgentConversation, 'sessionId' | 'archivedAt'>

/** Best-effort: a failed restore must never cost the user their admitted turn. */
export async function restoreArchivedSession(
  sessionId: string,
  origin: AgentSessionOrigin,
): Promise<void> {
  try {
    if (await restoreArchivedConversation(sessionId)) {
      logEvent('info', 'agent.conversation.unarchived_by_turn', { session_id: sessionId, origin })
    }
  } catch (err) {
    logError('agent.conversation.unarchive_by_turn_failed', err, { session_id: sessionId })
  }
}

/** Any turn brings an archived conversation back: a person's, an agent's or an event's. */
export async function restoreArchivedForTurn(
  conversation: ArchivableConversation | null | undefined,
  origin: AgentSessionOrigin,
): Promise<void> {
  if (conversation?.archivedAt) await restoreArchivedSession(conversation.sessionId, origin)
}
