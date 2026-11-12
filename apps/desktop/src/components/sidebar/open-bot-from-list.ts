import { botOfChannel, openBotChannel } from '../channels/botChannel'

import type { AgentConversation } from '../../api'

export function openBotFromList(
  teamId: string,
  botId: string,
  conversations: AgentConversation[],
  onSelect: (key: string) => void,
) {
  const chat = conversations.find((item) => botOfChannel(item.faces) === botId)

  if (chat) onSelect(`agent-session:${chat.sessionId}`)
  else openBotChannel(teamId, botId, onSelect)
}
