import { getConversationBySessionId } from '@/lib/agent/db'
import { isBotChat } from '@/lib/agent/db/archive'

/**
 * Whether one of the channels that woke a Bot's turn is its owner's own chat with
 * that Bot. Nobody but the owner is in it, so the owner can be asked there.
 */
export async function wokenInOwnerBotChat(args: {
  channelIds: readonly string[]
  agentSessionId: string
  ownerUserId: string
}): Promise<boolean> {
  const bot = await getConversationBySessionId(args.agentSessionId)

  if (!bot || bot.userId !== args.ownerUserId) return false
  for (const channelId of args.channelIds) {
    const chat = await getConversationBySessionId(channelId)

    if (
      chat &&
      isBotChat(chat) &&
      chat.userId === args.ownerUserId &&
      chat.teamId === bot.teamId &&
      chat.agentSessionIds?.[0] === args.agentSessionId
    )
      return true
  }

  return false
}

/** Only the owner can answer in that chat, so only a turn the owner runs is asked there. */
export function askableInOwnerBotChat(
  turn: {
    userId: string
    conversationOwnerUserId?: string
    conversationId: string
    run?: { channelIds?: readonly string[] }
  },
  inOwnerBotChat: typeof wokenInOwnerBotChat = wokenInOwnerBotChat,
): Promise<boolean> {
  const channelIds = turn.run?.channelIds ?? []
  const ownerUserId = turn.conversationOwnerUserId ?? turn.userId

  if (channelIds.length === 0 || turn.userId !== ownerUserId) return Promise.resolve(false)

  return inOwnerBotChat({ channelIds, agentSessionId: turn.conversationId, ownerUserId })
}
