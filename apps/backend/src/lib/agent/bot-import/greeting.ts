import { createHash } from 'node:crypto'

import type { CreatedTrigger, MessageMetadata } from '@/lib/agent/message-metadata'

import type { ImportItem } from './batch'

/** A UUID-shaped id that is the same for the same seed, so a retry finds what it made before. */
export function stableId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/** A Bot's opening message in its new private chat, with an id that is the same on every retry. */
export function greetingPost(
  item: Pick<ImportItem, 'sessionId' | 'privateChatId'>,
  name: string,
  agentRuntime: string,
  text: string,
  createdTriggers: CreatedTrigger[] = [],
  now = new Date(),
): { id: string; text: string; metadata: MessageMetadata } {
  return {
    id: stableId(`bot-greeting:${item.privateChatId}`),
    text,
    metadata: {
      version: 1,
      sender: { type: 'agent', id: item.sessionId, displayName: name, agentRuntime },
      source: 'agent.thread',
      sourceSessionId: item.sessionId,
      sentAt: now.toISOString(),
      ...(createdTriggers.length > 0 ? { createdTriggers } : {}),
    },
  }
}
