import { isSubAgentActive } from '../../lib/subAgentState.ts'

import type { AgentConversation } from '../../api/agent-types.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

/** A run that failed, not one the user stopped: its row shows the alert icon. */
function runFailed(runtimeState: RuntimeExecution | undefined): boolean {
  return ['failed', 'resume_failed'].includes(runtimeState?.phase ?? '')
}

/**
 * A thread its parent may count instead of listing: one the summary panel
 * calls done, unless it is the open chat, has a reply the viewer has not read,
 * or its run failed. Rows are rebuilt from the session list on every poll,
 * which also refreshes runtime states, so a counted thread that runs or asks
 * again is listed again.
 */
export function threadFoldsAway({
  conversation,
  runtimeState,
  open,
  unread,
}: {
  conversation: Pick<AgentConversation, 'inputRequests' | 'pendingDecision'>
  runtimeState: RuntimeExecution | undefined
  open: boolean
  unread: boolean
}): boolean {
  return (
    !open && !unread && !runFailed(runtimeState) && !isSubAgentActive(conversation, runtimeState)
  )
}
