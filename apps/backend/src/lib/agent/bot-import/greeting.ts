import { createHash } from 'node:crypto'

import type { CreatedTrigger, MessageMetadata } from '@/lib/agent/message-metadata'

import type { ImportItem } from './batch'

/** A Bot's opening message in its new private chat, with an id that is the same on every retry. */
export function greetingPost(
  item: Pick<ImportItem, 'sessionId' | 'privateChatId'>,
  name: string,
  agentRuntime: string,
  text: string,
  createdTriggers: CreatedTrigger[] = [],
  now = new Date(),
): { id: string; text: string; metadata: MessageMetadata } {
  const hex = createHash('sha256').update(`bot-greeting:${item.privateChatId}`).digest('hex')
  const id = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')

  return {
    id,
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
