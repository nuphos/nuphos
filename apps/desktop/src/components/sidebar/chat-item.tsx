import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'

import { chatRowIcon } from './chat-row-icon'
import { ChatRowStatus } from './ChatRowStatus'
import { SessionResources } from './SessionResources'

import type { Item } from './types'
import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'
import type { ReactNode } from 'react'

/** One chat row in the sidebar, plus whatever `actions` the caller adds. */
export function chatSidebarItem({
  conversation,
  teamId,
  active,
  runtimeState,
  unread,
  actions,
}: {
  conversation: AgentConversation
  teamId: string
  active: boolean
  runtimeState: RuntimeExecution | undefined
  unread: boolean
  actions?: ReactNode
}): Item {
  const status = <ChatRowStatus runtimeState={runtimeState} unread={unread} />

  return {
    key: `agent-session:${conversation.sessionId}`,
    label: conversation.title || conversation.firstMessage || 'Untitled agent',
    ...chatRowIcon(conversation),
    description: (
      <SessionResources
        sessionId={conversation.sessionId}
        teamId={teamId}
        resources={conversation.linkedResources ?? []}
      />
    ),
    enabled: true,
    active,
    ...(conversation.watching !== undefined ? { watching: conversation.watching } : {}),
    ...(conversation.parentSessionId
      ? { parentKey: `agent-session:${conversation.parentSessionId}` }
      : {}),
    href: pageLocationForNavigation(
      emptyNavigation({ kind: 'team', teamId }, 'team.agent', {
        agentSessionId: conversation.sessionId,
      }),
    ).href,
    trailing: status,
    foldedStatus: status,
    actions,
  }
}
