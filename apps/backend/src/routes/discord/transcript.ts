import { randomUUID } from 'node:crypto'

import { getConversationWithMessages } from '@/lib/agent/db'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'

import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { UIMessage } from 'ai'

function persistedMessage(message: {
  messageId: string
  role: string
  parts: unknown[]
  metadata?: unknown
}): UIMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const parts = message.parts.filter((part) => {
    if (!part || typeof part !== 'object') return false
    const type = (part as { type?: unknown }).type

    return (
      typeof type === 'string' &&
      (type === 'text' || type === 'step-start' || type.startsWith('tool-'))
    )
  })

  if (!parts.length) return null
  const metadata = parseMessageMetadata(message.metadata)

  return {
    id: message.messageId,
    role: message.role,
    parts,
    ...(metadata ? { metadata } : {}),
  } as UIMessage
}

export async function buildMessagesForDiscordTurn(args: {
  sessionId: string
  ownerUserId: string
  teamId: string
  renderedText: string
  metadata: MessageMetadata
  carried: PendingUserMessage[]
}): Promise<UIMessage[]> {
  const existing = await getConversationWithMessages(args.sessionId, args.ownerUserId, args.teamId)
  const prior = (existing?.messages ?? [])
    .map(persistedMessage)
    .filter((message): message is UIMessage => message !== null)

  return [
    ...prior,
    // Messages queued behind the previous turn keep their own author.
    ...args.carried.map((entry) => ({
      id: entry.id,
      role: 'user',
      metadata: entry.metadata,
      parts: [{ type: 'text', text: entry.renderedText }],
    })),
    {
      id: `discord-${randomUUID()}`,
      role: 'user',
      metadata: args.metadata,
      parts: [{ type: 'text', text: args.renderedText }],
    },
  ] as UIMessage[]
}
