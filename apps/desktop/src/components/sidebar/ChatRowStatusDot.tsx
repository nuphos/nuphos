import { chatRowIndicator, newestRuntimeSnapshot } from '../../lib/runtimeExecution'

import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

const DOTS = {
  turn: { label: 'Thread running', color: 'bg-success' },
  background: { label: 'Background task running', color: 'bg-warning' },
  unread: { label: 'Unread reply', color: 'bg-zViolet-500' },
} as const

export function ChatRowStatusDot({
  conversation,
  runtimeState,
  unread,
  showTurn = false,
}: {
  conversation: AgentConversation
  runtimeState: RuntimeExecution | undefined
  unread: boolean
  /** A running turn is normally the row's spinner icon; a folded parent has to show it here. */
  showTurn?: boolean
}) {
  const indicator = chatRowIndicator(
    newestRuntimeSnapshot(conversation.runtimeState, runtimeState),
    unread,
  )

  if (indicator === 'none' || (indicator === 'turn' && !showTurn)) return null
  const { label, color } = DOTS[indicator]

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex-shrink-0 group-hover:hidden w-1.5 h-1.5 rounded-full ${color}`}
    />
  )
}
