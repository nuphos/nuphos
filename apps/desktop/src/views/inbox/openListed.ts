import { openBotChannel } from '../../components/channels/botChannel.ts'
import { setSidebarMode } from '../../components/sidebar/sidebarModeStore.ts'
import { agentAvatarPick, isBotRow } from '../../lib/agentAvatarChoices.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

type Listed = Pick<AgentConversation, 'sessionId' | 'avatar' | 'kind'>

/**
 * Opens a conversation from the Inbox where the sidebar lists it, and turns the
 * sidebar to that page: a Bot by its chat, as its row in Bots opens it, a chat
 * in Bots, a Task in Tasks.
 */
export function openListed(teamId: string, listed: Listed, open: (sessionId: string) => void) {
  const bot = isBotRow(listed, agentAvatarPick(listed.sessionId))
  const show = (sessionId: string) => {
    setSidebarMode(teamId, bot || listed.kind === 'channel' ? 0 : 1)
    open(sessionId)
  }

  if (bot)
    openBotChannel(teamId, listed.sessionId, (key) => show(key.replace(/^agent-session:/, '')))
  else show(listed.sessionId)
}
