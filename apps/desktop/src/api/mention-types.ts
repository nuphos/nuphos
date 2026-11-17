import type { AgentProvider } from '../types/runtime.ts'

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
  /** Someone added the viewer here: announced, never listed. `sender` did it; `text` is empty. */
  invited?: boolean
  sender: { type: 'user' | 'agent' | 'system'; id: string; name: string } | null
  text: string
}

/** A teammate a message @mentions, as the server resolved them. */
export type AgentMessageMention = { id: string; displayName: string }

/** The message a message replies to, e.g. a Discord reply; `id` is a channel post's. */
export type AgentMessageReply = { id?: string; authorName: string; text: string }

/** The newest post that woke an agent: who posted it, its first line or file name, and how many came with it. */
export type AgentChannelPost = {
  id: string
  sender: {
    type: 'user' | 'agent' | 'system'
    id: string
    displayName: string
    avatarURL?: string
    agentRuntime?: AgentProvider
  }
  text: string
  more: number
}
