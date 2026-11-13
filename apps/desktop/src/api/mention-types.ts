/**
 * A message that @mentions the viewer, or an invite that brought them in, in a
 * channel or shared agent they have not posted in since.
 */
export type ChannelMention = {
  /** The conversation: a channel, or an agent shared with the viewer. */
  channelId: string
  kind?: 'channel' | 'agent'
  title: string
  /** An invite's is `invite:…`, with no message behind it. */
  messageId: string
  at: string
  /** Someone added the viewer here; `sender` is who did it and `text` is empty. */
  invited?: boolean
  sender: { type: 'user' | 'agent' | 'system'; id: string; name: string } | null
  text: string
}

/** A teammate a message @mentions, as the server resolved them. */
export type AgentMessageMention = { id: string; displayName: string }
