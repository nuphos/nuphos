import { useEffect, useRef, useState } from 'react'

import { useAgentAvatarPicks } from '../../lib/agentAvatarChoices'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { useAgentActivityTimes, useAgentUnreadSessions } from '../../lib/agentUnreadSessions'
import { runtimeTurnActive, runtimeBackgroundRunning } from '../../lib/runtimeExecution'
import { botOfChannel } from '../channels/botChannel'

import { botChatRows } from './bot-status'
import { chatSidebarItem, isBotRow } from './chat-item'
import { nextReplyInbox } from './replyInbox'
import { RowMenuButton } from './row-menu-button'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/**
 * The sidebar's chat rows: one per conversation, and under each Bot's chat its
 * sub-agents, with what they are doing.
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
  const activityTimes = useAgentActivityTimes()
  const avatarPicks = useAgentAvatarPicks()
  const openId = chatShown ? (agentSessionId ?? undefined) : undefined
  const previousUnread = useRef(unreadSessions)
  const previousWorking = useRef<ReadonlySet<string>>(new Set())
  const [pendingReplies, setPendingReplies] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const working = new Set(
      agentSessions
        .filter((conversation) => {
          const state = runtimeStates.get(conversation.sessionId) ?? conversation.runtimeState

          return (
            runtimeTurnActive(state) ||
            runtimeBackgroundRunning(state) ||
            Boolean(conversation.activeRun)
          )
        })
        .map((conversation) => conversation.sessionId),
    )
    const beforeUnread = previousUnread.current

    previousUnread.current = unreadSessions
    const before = previousWorking.current

    previousWorking.current = working
    setPendingReplies((pending) => {
      const next = nextReplyInbox(pending, before, working, openId, beforeUnread)

      return next.size === pending.size && [...next].every((id) => pending.has(id)) ? pending : next
    })
  }, [agentSessions, runtimeStates, openId, unreadSessions])
  const byId = new Map(agentSessions.map((conversation) => [conversation.sessionId, conversation]))
  const kidsOf = new Map<string, AgentConversation[]>()

  // A Bot is never listed as a sub-agent under another Bot's chat; it has a row of its own.
  for (const conversation of agentSessions)
    if (
      conversation.parentSessionId &&
      !isBotRow(conversation, avatarPicks.get(conversation.sessionId))
    )
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
      conversation: {
        ...conversation,
        lastActiveAt: activityTimes.get(conversation.sessionId) ?? conversation.lastActiveAt,
      },
      teamId,
      active: chatShown && agentSessionId === conversation.sessionId,
      runtimeState: runtimeStates.get(conversation.sessionId),
      unread,
      picked: avatarPicks.get(conversation.sessionId),
    })
    // A menu rather than a one-click archive: a stray click only opens it.
    const row = {
      ...item,
      ...(pendingReplies.has(conversation.sessionId) && {
        taskState: 'attention' as const,
        finished: false,
      }),
      actions: <RowMenuButton title={item.label} />,
    }
    const botId = conversation.kind === 'channel' ? botOfChannel(conversation.faces) : undefined

    if (!botId) return [row]
    const bot = byId.get(botId)

    return botChatRows({
      openId,
      unreadIds: unreadSessions,
      faces: conversation.faces,
      chat: row,
      bot: bot && run(bot),
      kids: (kidsOf.get(botId) ?? []).map(run),
      teamId,
      unread,
    })
  })
}
