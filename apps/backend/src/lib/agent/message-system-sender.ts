import type { MessageMetadata } from './message-metadata'

/** Who a turn no person typed is from: a Trigger, a channel, GitHub, or Nuphos itself. */
export function systemSender(
  id: string,
  displayName: string,
  resourceUrl?: string,
): MessageMetadata {
  return {
    version: 1,
    sender: { type: 'system', id, displayName },
    source: 'agent.resource',
    ...(resourceUrl ? { resourceUrl } : {}),
    sentAt: new Date().toISOString(),
  }
}
