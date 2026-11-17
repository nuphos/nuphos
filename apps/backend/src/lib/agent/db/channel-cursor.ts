// An agent's place in each channel it reads: the index of the last post it read.
import { agentConversations } from './shared'

/** Moves the agent's place in a channel forward to `index`. */
export async function markChannelRead(channelId: string, agentSessionId: string, index: number) {
  await agentConversations().updateOne(
    { sessionId: channelId },
    // Two reads at once must not move the place back.
    { $max: { [`agentReadIndex.${agentSessionId}`]: index } },
  )
}

/** Puts the agent's place back to `from`, unless it has read past `to` since. */
export async function unmarkChannelRead(
  channelId: string,
  agentSessionId: string,
  from: number | undefined,
  to: number,
) {
  const field = `agentReadIndex.${agentSessionId}`

  await agentConversations().updateOne(
    { sessionId: channelId, [field]: to },
    from === undefined ? { $unset: { [field]: '' } } : { $set: { [field]: from } },
  )
}
