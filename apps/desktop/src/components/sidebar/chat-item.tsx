import { t } from '../../i18n'
import { openInputRequests } from '../../lib/agentInputRequests'
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { runtimeTurnActive, runtimeBackgroundRunning } from '../../lib/runtimeExecution'
import { sidebarTaskState } from '../../lib/sidebarTaskState'
import { rowDot } from '../../lib/subAgentState'
import { botOfChannel } from '../channels/botChannel'
import { ChatIcon } from '../channels/channelParts'

import { chatPreview, chatTime } from './chat-preview'
import { chatRowAccess } from './chat-row-access'
import { chatRowIcon } from './chat-row-icon'
import { ChatRowStatus } from './ChatRowStatus'
import { PhoneViewingBadge } from './PhoneViewingBadge'
import { SessionResources } from './SessionResources'
import { threadFoldsAway } from './thread-status'

import type { Item } from './types'
import type { AgentConversation } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'

/** A Bot: a face, picked in this app since the list loaded (null: taken away) or stored. */
export function isBotRow(
  conversation: Pick<AgentConversation, 'avatar' | 'kind'>,
  picked?: string | null,
): boolean {
  return Boolean(
    (picked === undefined ? conversation.avatar : picked) && conversation.kind !== 'channel',
  )
}

/** One chat row in the sidebar; the caller adds its row actions. */
export function chatSidebarItem({
  conversation,
  teamId,
  active,
  runtimeState,
  unread,
  picked,
}: {
  conversation: AgentConversation
  teamId: string
  active: boolean
  runtimeState: RuntimeExecution | undefined
  unread: boolean
  /** A face picked in this app since the list loaded (null: taken away), which wins. */
  picked?: string | null
}): Item {
  const isBot = isBotRow(conversation, picked)
  const waiting = openInputRequests(conversation).length > 0 || Boolean(conversation.signInRequest)
  const dot = waiting ? 'waiting' : unread ? 'unread' : rowDot(conversation, runtimeState, unread)
  const status = <ChatRowStatus runtimeState={runtimeState} dot={dot} />

  return {
    key: `agent-session:${conversation.sessionId}`,
    label:
      conversation.title ||
      conversation.firstMessage ||
      // An unnamed chat is called by its other members; until anyone joins, this.
      (conversation.kind === 'channel' ? t('New Group Chat') : t('Untitled agent')),
    ...chatRowIcon(conversation),
    preview: chatPreview(conversation.lastMessage, conversation.faces),
    lastActiveAt: conversation.lastActiveAt,
    unread,
    time: chatTime(conversation.lastActiveAt),
    description: (
      <SessionResources
        sessionId={conversation.sessionId}
        teamId={teamId}
        resources={conversation.linkedResources ?? []}
      />
    ),
    provider: conversation.agentRuntime,
    enabled: true,
    active,
    ...(conversation.kind === 'channel'
      ? {
          channel: true,
          botChannelOf: botOfChannel(conversation),
          channelAgentIds: conversation.agentSessionIds,
        }
      : {}),
    ...(isBot
      ? {
          bot: true,
          face: (
            <ChatIcon
              faces={[
                {
                  id: conversation.sessionId,
                  name: conversation.title,
                  agent: { avatar: conversation.avatar, provider: conversation.agentRuntime },
                },
              ]}
              title={conversation.title}
              sidebar
            />
          ),
        }
      : {}),
    ...chatRowAccess(conversation),
    ...(conversation.watching !== undefined ? { watching: conversation.watching } : {}),
    // A Bot stands on its own: even one an agent nested is a top-level Bot, never a sub-task.
    ...(conversation.parentSessionId && !isBot
      ? { parentKey: `agent-session:${conversation.parentSessionId}` }
      : {}),
    href: pageLocationForNavigation(
      emptyNavigation({ kind: 'team', teamId }, 'team.agent', {
        agentSessionId: conversation.sessionId,
      }),
    ).href,
    trailing: status,
    // A phone viewing this chat's dock tab shows here too, where the tab itself may be out of
    // sight. Not in the trailing slot: hover swaps that for the row's actions, hiding Stop.
    note: <PhoneViewingBadge sessionId={conversation.sessionId} />,
    foldedStatus: status,
    finished: threadFoldsAway({
      conversation,
      runtimeState,
      open: active,
      unread: unread || waiting,
    }),
    dot,
    taskState:
      isBot || conversation.kind === 'channel'
        ? undefined
        : sidebarTaskState({
            waiting,
            working:
              runtimeTurnActive(runtimeState ?? conversation.runtimeState) ||
              runtimeBackgroundRunning(runtimeState ?? conversation.runtimeState) ||
              Boolean(conversation.activeRun),
            unread,
          }),
    ...(conversation.workspace && { projectPath: conversation.workspace.path }),
  }
}
