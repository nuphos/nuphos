import { t } from '../../i18n'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'

import { chatRowIcon } from './chat-row-icon'
import { ChatRowStatus } from './ChatRowStatus'
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
  const status = <ChatRowStatus runtimeState={runtimeState} unread={unread} />

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
    ...(conversation.kind === 'channel' ? { channel: true } : {}),
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
    finished: threadFoldsAway({ conversation, runtimeState, open: active, unread }),
  }
}
