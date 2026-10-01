import { getConversationWithMessages } from '@/lib/agent/db'

import type { UIMessage } from 'ai'

// Concatenate the text parts of a persisted transcript message. Non-text parts
// (tool calls, etc.) are ignored — the caller wants the assistant's prose.
export function partsToText(parts: unknown[]): string {
  return parts
    .map((part) =>
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .filter(Boolean)
    .join('')
}

function persistedPartToUiMessagePart(part: unknown): unknown[] {
  if (!part || typeof part !== 'object') return []
  const value = part as Record<string, unknown>

  if (value.type === 'text' && typeof value.text === 'string') {
    return [{ type: 'text', text: value.text }]
  }
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
  if (typeof value.type === 'string' && value.type.startsWith('tool-')) {
    return [value]
  }

  return []
}

export function persistedMessageToUiMessage(message: {
  messageId: string
  role: string
  parts: unknown[]
}): UIMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const parts = message.parts.flatMap(persistedPartToUiMessagePart)

  if (parts.length === 0) return null

  return { id: message.messageId, role: message.role, parts } as UIMessage
}

export async function readLatestAnswer(
  sessionId: string,
  viewerUserId: string,
  teamId: string | undefined,
): Promise<string | null> {
  const result = await getConversationWithMessages(sessionId, viewerUserId, teamId)

  if (!result) return null
  const assistant = [...result.messages].reverse().find((m) => m.role === 'assistant')

  return assistant ? partsToText(assistant.parts) : null
}
