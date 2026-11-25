import { randomUUID } from 'node:crypto'

import { getConversationWithMessages } from '@/lib/agent/db'
import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { UIMessage } from 'ai'

export async function buildMessagesForLarkTurn(args: {
  sessionId: string
  userId: string
  teamId: string
  renderedText: string
  metadata: MessageMetadata
  // Messages queued while a turn was running but never drained by it (the run
  // ended in the same instant) lead the turn they finally join.
  carried: PendingUserMessage[]
  // Vision parts for images the user attached; they lead the message so the
  // model has looked at the screenshot before it reads the question about it.
  attachmentParts?: unknown[]
}): Promise<UIMessage[]> {
  const existing = await getConversationWithMessages(args.sessionId, args.userId, args.teamId)
  const prior = existing?.messages
    .map(persistedMessageToUiMessage)
    .filter((m): m is UIMessage => m !== null)

  return [
    ...(prior ?? []),
    ...args.carried.map((entry) => ({
      id: entry.id,
      role: 'user',
      metadata: entry.metadata,
      parts: [{ type: 'text', text: entry.renderedText }],
    })),
    {
      id: `lark-${randomUUID()}`,
      role: 'user',
      metadata: args.metadata,
      parts: [...(args.attachmentParts ?? []), { type: 'text', text: args.renderedText }],
    },
  ] as UIMessage[]
}
