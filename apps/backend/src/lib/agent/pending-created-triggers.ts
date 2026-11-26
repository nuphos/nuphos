import { agentConversations } from './db'

/** The Triggers a new Bot was set up with, taken by its first post in this chat only. */
export async function takeCreatedTriggers(channelId: string, botSessionId: string) {
  const before = await agentConversations().findOneAndUpdate(
    { sessionId: channelId, 'pendingCreatedTriggers.botSessionId': botSessionId },
    { $unset: { pendingCreatedTriggers: '' } },
    { returnDocument: 'before', projection: { pendingCreatedTriggers: 1 } },
  )

  return before?.pendingCreatedTriggers?.triggers ?? []
}
