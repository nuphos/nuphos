import { botOfChannel } from '../channels/botChats.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

/**
 * The chats the sidebar lists as Bots' chats, each with its Bot. A chat whose
 * agent is no longer a Bot (its face was taken away) is a plain chat: it
 * neither stands for that agent in Bots nor links its Task to it. `picks`
 * holds avatars picked since the last fetch; an agent the list does not hold,
 * such as a teammate's Bot, is taken to be the Bot its chat says.
 */
export function listedBotChats(
  sessions: readonly AgentConversation[],
  picks: ReadonlyMap<string, string | null>,
): Map<string, string> {
  const byId = new Map(sessions.map((conversation) => [conversation.sessionId, conversation]))
  const isBot = (id: string) => {
    if (picks.has(id)) return Boolean(picks.get(id))
    const agent = byId.get(id)

    return agent ? Boolean(agent.avatar) : true
  }
  const listed = new Map<string, string>()

  for (const conversation of sessions) {
    const botId = conversation.kind === 'channel' ? botOfChannel(conversation.faces) : undefined

    if (botId && isBot(botId)) listed.set(conversation.sessionId, botId)
  }

  return listed
}
