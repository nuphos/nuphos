/** A message that @mentions the viewer in a channel or shared agent they have not posted in since. */
export type ChannelMention = {
  /** The conversation: a channel, or an agent shared with the viewer. */
  channelId: string
  kind?: 'channel' | 'agent'
  title: string
  messageId: string
  at: string
  sender: { type: 'user' | 'agent' | 'system'; id: string; name: string } | null
  text: string
}

/** A teammate a message @mentions, as the server resolved them. */
export type AgentMessageMention = { id: string; displayName: string }
