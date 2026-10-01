import { randomUUID } from 'node:crypto'

import { getConversationWithMessages } from '@/lib/agent/db'

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
}): UIMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const parts = message.parts.flatMap(persistedPartToUiMessagePart)

  if (parts.length === 0) return null

  return { id: message.messageId, role: message.role, parts } as UIMessage
}

export function renderLarkUserMessage(senderName: string, text: string): string {
  return `${senderName} wrote over Lark:\n\n${text}`
}

export async function buildMessagesForLarkTurn(args: {
  sessionId: string
  userId: string
  teamId: string
  renderedText: string
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
    {
      id: `lark-${randomUUID()}`,
      role: 'user',
      parts: [...(args.attachmentParts ?? []), { type: 'text', text: args.renderedText }],
    },
  ] as UIMessage[]
}

// Messages queued while a turn was running but never drained by it (the run
// ended in the same instant) lead the turn they finally join.
export function composeCarriedText(carried: PendingUserMessage[], renderedText: string): string {
  return [...carried.map((message) => message.renderedText), renderedText].join('\n\n')
}
