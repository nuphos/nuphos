import { randomUUID } from 'node:crypto'

import { getConversationWithMessages } from '@/lib/agent/db'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'

import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { UIMessage } from 'ai'

// ─── Transcript rebuild (shared shape with Slack) ────────────────────────────
function persistedPartToUiMessagePart(part: unknown): unknown[] {
  if (!part || typeof part !== 'object') return []
  const value = part as Record<string, unknown>

  if (value.type === 'text' && typeof value.text === 'string')
    return [{ type: 'text', text: value.text }]
  if (value.type === 'step-start') return [{ type: 'step-start' }]
  if (
    value.type === 'tool' &&
    typeof value.toolName === 'string' &&
    typeof value.toolCallId === 'string' &&
    typeof value.state === 'string'
  ) {
    return [
      {
        type: `tool-${value.toolName}`,
        toolCallId: value.toolCallId,
        state: value.state,
        ...(value.input !== undefined ? { input: value.input } : {}),
        ...(value.output !== undefined ? { output: value.output } : {}),
        ...(typeof value.errorText === 'string' ? { errorText: value.errorText } : {}),
      },
    ]
  }
  if (typeof value.type === 'string' && value.type.startsWith('tool-')) return [value]

  return []
}

function persistedMessageToUiMessage(message: {
  messageId: string
  role: string
  parts: unknown[]
  metadata?: unknown
}): UIMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const parts = message.parts.flatMap(persistedPartToUiMessagePart)

  if (parts.length === 0) return null
  const metadata = parseMessageMetadata(message.metadata)

  return {
    id: message.messageId,
    role: message.role,
    parts,
    ...(metadata ? { metadata } : {}),
  } as UIMessage
}

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
