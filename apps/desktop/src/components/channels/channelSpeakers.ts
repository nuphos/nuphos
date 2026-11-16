import type { AgentMessageMetadata } from '../../api'

/**
 * Only people and agents speak in a channel. Any other sender (a system notice)
 * is never shown as a post: it would read as someone talking.
 */
export function speaksInChannel(sender: Pick<AgentMessageMetadata['sender'], 'type'>): boolean {
  return sender.type === 'user' || sender.type === 'agent'
}

/**
 * The records Nuphos leaves in a chat, each a muted line rather than a post:
 * an answer to an agent's question, and a change of owner when the owner leaves.
 */
export function isChannelRecord(sender: Pick<AgentMessageMetadata['sender'], 'id'>): boolean {
  return sender.id === 'nuphos:decision' || sender.id === 'nuphos:chat'
}
