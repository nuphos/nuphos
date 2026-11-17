import { AppError } from '@/lib/errors'

import { isBotChat } from './archive'
import { agentConversations } from './shared'

import type { AgentConversation } from './shared'

/** A chat holds people and Bots: a Task speaks through the Bot above it. */
export async function assertBot(agentSessionId: string) {
  const bot = await agentConversations().findOne(
    { sessionId: agentSessionId, kind: { $ne: 'channel' }, avatar: { $exists: true } },
    { projection: { _id: 1 } },
  )

  if (!bot) throw new AppError(409, 'not_a_bot', 'Only a Bot can be in a chat, not a Task')
}

/** Who speaks in a chat for this agent: itself as a Bot, else the Bot above it, the same owner's. */
export async function speakingBot(self: AgentConversation): Promise<AgentConversation> {
  const above = self.parentSessionId
    ? await agentConversations().findOne({ sessionId: self.parentSessionId })
    : null
  const bot = self.avatar ? self : above

  if (!bot?.avatar || bot.userId !== self.userId || bot.kind === 'channel')
    throw new Error('Only a Bot can be in a chat, and no Bot is above this Task to join for it.')

  return bot
}

/**
 * A Bot made a Task again leaves every group chat. Its 1:1 chats are archived
 * with it still in them, so making it a Bot again brings back the latest.
 */
export async function leaveChats(agentSessionId: string) {
  const chats = await agentConversations()
    .find({ kind: 'channel', agentSessionIds: agentSessionId })
    .toArray()
  const own = chats.filter(isBotChat).map((chat) => chat.sessionId)

  await agentConversations().updateMany(
    { sessionId: { $in: own }, archivedAt: { $exists: false } },
    { $set: { archivedAt: new Date() } },
  )
  for (const chat of chats.filter((one) => !own.includes(one.sessionId)))
    await agentConversations().updateOne(
      { sessionId: chat.sessionId },
      {
        $pull: { agentSessionIds: agentSessionId },
        // A lead that left leads no more.
        ...(chat.leadAgentSessionId === agentSessionId
          ? { $unset: { leadAgentSessionId: '' } }
          : {}),
      },
    )
}
