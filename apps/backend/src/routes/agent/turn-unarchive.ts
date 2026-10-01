import { restoreArchivedConversation } from '@/lib/agent/db'
import { logError, logEvent } from '@/lib/observability'

import type { AgentConversation } from '@/lib/agent/db'
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'

type ArchivableConversation = Pick<AgentConversation, 'sessionId' | 'archivedAt'>

/** Trigger turns run headless, so they leave the archive alone. */
export function shouldRestoreArchivedForTurn(
  conversation: ArchivableConversation | null | undefined,
  origin: AgentSessionOrigin,
): conversation is ArchivableConversation {
  return Boolean(conversation?.archivedAt) && origin === 'user'
}

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

export async function restoreArchivedForTurn(
  conversation: ArchivableConversation | null | undefined,
  origin: AgentSessionOrigin,
): Promise<void> {
  if (shouldRestoreArchivedForTurn(conversation, origin)) {
    await restoreArchivedSession(conversation.sessionId, origin)
  }
}
