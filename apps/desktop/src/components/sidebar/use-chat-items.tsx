import { useAgentAvatarPicks } from '../../lib/agentAvatarChoices'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { useAgentUnreadSessions } from '../../lib/agentUnreadSessions'
import { setOpenedFromBots, useOpenedFromBots } from '../../lib/botNestedSelection'
import { botOfChannel } from '../channels/botChannel'

import { botChatRows } from './bot-status'
import { chatSidebarItem } from './chat-item'
import { RowMenuButton } from './row-menu-button'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/**
 * The sidebar's chat rows: one per conversation, and under each Bot's chat its
 * own Task and that Task's sub-agents, with what they are doing.
 */
export function useChatItems({
  agentSessions,
  teamId,
  chatShown,
  agentSessionId,
}: {
  agentSessions: AgentConversation[]
  teamId: string
  chatShown: boolean
  agentSessionId: string | null
}): Item[] {
  const runtimeStates = useAgentRuntimeStates()
  const unreadSessions = useAgentUnreadSessions()
  const avatarPicks = useAgentAvatarPicks()
  const fromBots = useOpenedFromBots()
  const openId = chatShown ? (agentSessionId ?? undefined) : undefined
  // Bots whose chats exist: their sub-agents are listed twice while the tree is on.
  const botIds = new Set(
    agentSessions.flatMap((c) => (c.kind === 'channel' ? (botOfChannel(c.faces) ?? []) : [])),
  )
  const byId = new Map(agentSessions.map((conversation) => [conversation.sessionId, conversation]))
  const kidsOf = new Map<string, AgentConversation[]>()

  for (const conversation of agentSessions)
    if (conversation.parentSessionId)
      kidsOf.set(conversation.parentSessionId, [
        ...(kidsOf.get(conversation.parentSessionId) ?? []),
        conversation,
      ])
  const run = (conversation: AgentConversation) => ({
    conversation,
    runtimeState: runtimeStates.get(conversation.sessionId),
  })

  return agentSessions.flatMap((conversation) => {
    const unread = unreadSessions.has(conversation.sessionId)
    const item = chatSidebarItem({
      conversation,
      teamId,
      active: chatShown && agentSessionId === conversation.sessionId,
      runtimeState: runtimeStates.get(conversation.sessionId),
      unread,
      picked: avatarPicks.get(conversation.sessionId),
    })
    // A menu rather than a one-click archive: a stray click only opens it.
    const listedTwice =
      botIds.has(conversation.sessionId) ||
      Boolean(conversation.parentSessionId && botIds.has(conversation.parentSessionId))
    const row = {
      ...item,
      actions: <RowMenuButton title={item.label} />,
      ...(listedTwice && {
        active: item.active && !fromBots.has(conversation.sessionId),
        onPress: () => setOpenedFromBots(conversation.sessionId, false),
      }),
    }
    const botId = conversation.kind === 'channel' ? botOfChannel(conversation.faces) : undefined

    if (!botId) return [row]
    const bot = byId.get(botId)

    return botChatRows({
      openId,
      fromBots,
      faces: conversation.faces,
      chat: row,
      bot: bot && run(bot),
      kids: (kidsOf.get(botId) ?? []).map(run),
      teamId,
      unread,
    })
  })
}
