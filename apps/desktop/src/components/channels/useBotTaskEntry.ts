import { botIsOnboarding } from '../../lib/agentInputRequests'
import { useAgentSessions } from '../sidebar/agentSessions'

import { hasEarlierBotChat } from './botEarlierChat'
import { useBotTaskAccess } from './useBotTaskAccess'

import type { AgentConversation } from '../../api'

/**
 * Whether a Bot's chat may open the Bot's own Task, as its title bar pill does,
 * and whether that Task holds a conversation from before this chat (#5061).
 * Neither while the Bot is still being set up.
 */
export function useBotTaskEntry(
  teamId: string,
  bot: string | undefined,
  owned: boolean,
  chat: Pick<AgentConversation, 'createdAt'> | null | undefined,
) {
  const row = useAgentSessions(teamId).data?.find((session) => session.sessionId === bot)
  const settingUp = row ? botIsOnboarding(row) : false
  const canOpenTask = useBotTaskAccess(teamId, bot, owned) && !settingUp

  return { canOpenTask, earlier: canOpenTask && hasEarlierBotChat(row, chat) }
}
