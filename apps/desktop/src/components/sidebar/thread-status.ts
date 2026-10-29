import { openInputRequests } from '../../lib/agentInputRequests.ts'
import { chatRowIndicator } from '../../lib/runtimeExecution.ts'

import type { AgentConversation } from '../../api/agent-types.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

type Thread = Pick<AgentConversation, 'inputRequests' | 'pendingDecision'>

/**
 * A thread the summary panel calls Done: no turn or background work running
 * and no question waiting. A stopped or unreachable runtime is done too.
 */
export function threadDone(conversation: Thread, runtimeState: RuntimeExecution | undefined) {
  const indicator = chatRowIndicator(runtimeState, false)

  return (
    indicator !== 'turn' &&
    indicator !== 'background' &&
    openInputRequests(conversation).length === 0
  )
}

/** A run that failed, not one the user stopped: its row shows the alert icon. */
function runFailed(runtimeState: RuntimeExecution | undefined): boolean {
  return ['failed', 'resume_failed'].includes(runtimeState?.phase ?? '')
}

/**
 * A done thread its parent may count instead of listing: the sidebar keeps it
 * while it is the open chat, has a reply the viewer has not read, or its run
 * failed.
 */
export function threadFoldsAway({
  conversation,
  runtimeState,
  open,
  unread,
}: {
  conversation: Thread
  runtimeState: RuntimeExecution | undefined
  open: boolean
  unread: boolean
}): boolean {
  return !open && !unread && !runFailed(runtimeState) && threadDone(conversation, runtimeState)
}
