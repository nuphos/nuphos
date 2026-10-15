import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { newestRuntimeSnapshot } from '../../lib/runtimeExecution'
import { threadRunning } from '../../lib/threadLifecycle'

import { chatRowIcon } from './chat-row-icon'
import { ChatRowStatus } from './ChatRowStatus'
import { SessionResources } from './SessionResources'

import type { Item } from './types'
import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'
import type { ReactNode } from 'react'

/**
 * One chat row, shared by the Chats section and the Shared section so both read
 * and behave identically. The difference between them is ownership, expressed
 * through `readOnly` (no rename — that is the owner's; archive only for a
 * chat the viewer manages) and whatever `actions` the caller adds.
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
  const status = (
    <ChatRowStatus conversation={conversation} runtimeState={runtimeState} unread={unread} />
  )

  return {
    key: `agent-session:${conversation.sessionId}`,
    label: conversation.title || conversation.firstMessage || 'Untitled chat',
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
    activeAt: Date.parse(conversation.lastActiveAt) || 0,
    ...(readOnly ? { readOnlyChat: true } : {}),
    ...(readOnly && conversation.canManage ? { managedChat: true } : {}),
    ...(conversation.parentSessionId
      ? {
          parentKey: `agent-session:${conversation.parentSessionId}`,
          threadDone: !threadRunning(
            newestRuntimeSnapshot(conversation.runtimeState, runtimeState),
          ),
        }
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
