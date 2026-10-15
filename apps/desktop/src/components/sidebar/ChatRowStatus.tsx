import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react'

import {
  chatRowIndicator,
  newestRuntimeSnapshot,
  runtimeStateLabel,
} from '../../lib/runtimeExecution'
import { threadRunning } from '../../lib/threadLifecycle'

import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

const DOTS = {
  background: { label: 'Background task running', color: 'bg-warning' },
  unread: { label: 'Unread reply', color: 'bg-zViolet-500' },
} as const

/** The row's status at its right edge; the left icon only ever names the agent. */
export function ChatRowStatus({
  conversation,
  runtimeState,
  unread,
}: {
  conversation: AgentConversation
  runtimeState: RuntimeExecution | undefined
  unread: boolean
}) {
  const state = newestRuntimeSnapshot(conversation.runtimeState, runtimeState)
  const indicator = chatRowIndicator(state, unread)

  if (indicator === 'none') {
    // A thread says whether its work is finished; a top-level chat shows nothing at rest.
    if (!conversation.parentSessionId || threadRunning(state)) return null

    return (
      <span title="Done" className="flex-shrink-0 flex items-center text-tertiary">
        <CircleCheck className="h-3.5 w-3.5" aria-label="Done" />
      </span>
    )
  }
  if (indicator === 'turn' || indicator === 'error') {
    const Icon = indicator === 'turn' ? Loader2 : CircleAlert

    return (
      <span
        title={runtimeStateLabel(state)}
        className="flex-shrink-0 flex items-center text-tertiary"
      >
        <Icon
          className={`h-3.5 w-3.5 ${indicator === 'turn' ? 'animate-spin' : ''}`}
          aria-label={runtimeStateLabel(state)}
        />
      </span>
    )
  }
  const { label, color } = DOTS[indicator]

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${color}`}
    />
  )
}
