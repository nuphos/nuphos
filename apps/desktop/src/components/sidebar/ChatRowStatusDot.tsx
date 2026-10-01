import { chatRowIndicator } from '../../lib/runtimeExecution'

import { useRuntimeObservation } from './useRuntimeObservation'

import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

const DOTS = {
  background: { label: 'Background task running', color: 'bg-warning' },
  unread: { label: 'Unread reply', color: 'bg-zViolet-500' },
} as const

export function ChatRowStatusDot({
  conversation,
  runtimeState,
  unread,
}: {
  conversation: AgentConversation
  runtimeState: RuntimeExecution | undefined
  unread: boolean
}) {
  const indicator = chatRowIndicator(useRuntimeObservation(conversation, runtimeState), unread)

  if (indicator !== 'background' && indicator !== 'unread') return null
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
