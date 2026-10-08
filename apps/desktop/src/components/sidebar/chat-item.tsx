import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'

import { chatRowIcon } from './chat-row-icon'
import { ChatRowStatusDot } from './ChatRowStatusDot'

import type { Item } from './types'
import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'
import type { ReactNode } from 'react'

/**
 * One chat row, shared by the Chats section and the Shared section so both read
 * and behave identically. The difference between them is ownership, expressed
 * through `readOnly` (no rename/archive — those are the owner's, and the
 * backend scopes them to the owner) and whatever `actions` the caller adds.
 */
export function chatSidebarItem({
  conversation,
  teamId,
  active,
  runtimeState,
  unread,
  readOnly,
  actions,
}: {
  conversation: AgentConversation
  teamId: string
  active: boolean
  runtimeState: RuntimeExecution | undefined
  unread: boolean
  readOnly?: boolean
  actions?: ReactNode
}): Item {
  return {
    key: `agent-session:${conversation.sessionId}`,
    label: conversation.title || conversation.firstMessage || 'Untitled chat',
    ...chatRowIcon(conversation, runtimeState),
    enabled: true,
    active,
    ...(readOnly ? { readOnlyChat: true } : {}),
    href: pageLocationForNavigation(
      emptyNavigation({ kind: 'team', teamId }, 'team.agent', {
        agentSessionId: conversation.sessionId,
      }),
    ).href,
    trailing: (
      <ChatRowStatusDot conversation={conversation} runtimeState={runtimeState} unread={unread} />
    ),
    actions,
  }
}
