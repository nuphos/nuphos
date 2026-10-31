import { t } from '../../i18n'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { rowDot } from '../../lib/subAgentState'

import { chatRowIcon } from './chat-row-icon'
import { ChatRowStatus } from './ChatRowStatus'
import { PhoneViewingBadge } from './PhoneViewingBadge'
import { SessionResources } from './SessionResources'
import { threadFoldsAway } from './thread-status'

import type { Item } from './types'
import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

/** One chat row in the sidebar; the caller adds its row actions. */
export function chatSidebarItem({
  conversation,
  teamId,
  active,
  runtimeState,
  unread,
}: {
  conversation: AgentConversation
  teamId: string
  active: boolean
  runtimeState: RuntimeExecution | undefined
  unread: boolean
}): Item {
  const dot = rowDot(conversation, runtimeState, unread)
  const status = <ChatRowStatus runtimeState={runtimeState} dot={dot} />
  // A phone viewing this chat's dock tab shows here too, where the tab itself may be out of sight.
  const trailing = (
    <>
      <PhoneViewingBadge sessionId={conversation.sessionId} />
      {status}
    </>
  )

  return {
    key: `agent-session:${conversation.sessionId}`,
    label: conversation.title || conversation.firstMessage || t('Untitled agent'),
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
    trailing,
    foldedStatus: status,
    finished: threadFoldsAway({ conversation, runtimeState, open: active }),
    dot,
  }
}
