import { Loader2, MessageSquare, CircleAlert } from 'lucide-react'

import {
  newestRuntimeSnapshot,
  runtimeTurnActive,
  runtimeStateLabel,
} from '../../lib/runtimeExecution'
import { AgentProviderIcon } from '../agent/panel/icons'

import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

export function RuntimeChatIcon({
  conversation,
  runtimeState,
}: {
  conversation: AgentConversation
  runtimeState: RuntimeExecution | undefined
}) {
  const state = newestRuntimeSnapshot(conversation.runtimeState, runtimeState)

  if (runtimeTurnActive(state)) {
    return (
      <span title={runtimeStateLabel(state)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={runtimeStateLabel(state)} />
      </span>
    )
  }
  if (
    conversation.claudeCodeRuntimeAttached &&
    (!['idle', 'dormant'].includes(state?.state ?? '') ||
      ['failed', 'resume_failed', 'stopped'].includes(state?.phase ?? ''))
  ) {
    return (
      <span title={runtimeStateLabel(state)}>
        <CircleAlert className="h-3.5 w-3.5" aria-label={runtimeStateLabel(state)} />
      </span>
    )
  }
  if (!conversation.claudeCodeRuntimeAttached) return <MessageSquare className="h-3.5 w-3.5" />

  return <AgentProviderIcon provider={conversation.agentRuntime} className="h-3.5 w-3.5" />
}
