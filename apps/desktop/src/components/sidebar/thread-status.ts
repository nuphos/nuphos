import { isSubAgentActive, subAgentRunFailed } from '../../lib/subAgentState.ts'

import type { AgentConversation } from '../../api/agent-types.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

/**
 * A thread its parent may count instead of listing: one the summary panel
 * calls done, unless it is the open chat or its run failed. Rows are rebuilt
 * from the session list on every poll, which also refreshes runtime states, so
 * a counted thread that runs or asks again is listed again.
 */
export function threadFoldsAway({
  conversation,
  runtimeState,
  open,
}: {
  conversation: Pick<AgentConversation, 'inputRequests' | 'pendingDecision'>
  runtimeState: RuntimeExecution | undefined
  open: boolean
}): boolean {
  return !open && !subAgentRunFailed(runtimeState) && !isSubAgentActive(conversation, runtimeState)
}
