import type { AgentMessageMetadata } from '../../api'

/**
 * Only people and agents speak in a channel. Any other sender (a system notice)
 * is never shown as a post: it would read as someone talking.
 */
export function speaksInChannel(sender: Pick<AgentMessageMetadata['sender'], 'type'>): boolean {
  return sender.type === 'user' || sender.type === 'agent'
}
