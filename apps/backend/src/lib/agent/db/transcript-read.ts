import { renderAttributedMessage } from '../message-metadata'
import { getReadableConversation } from './conversations'
import { agentMessages } from './shared'

import type { AgentMessage } from './shared'

const TRANSCRIPT_MESSAGE_MAX_CHARS = 4_000

function messageTextParts(parts: unknown[]): string[] {
  const out: string[] = []

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const { type, text } = part as { type?: unknown; text?: unknown }

    if (type === 'text' && typeof text === 'string' && text.trim()) out.push(text)
  }

  return out
}

const TOOL_DETAIL_MAX_CHARS = 1_500

type ToolPart = { name: string; input?: unknown; output?: unknown }

function messageToolParts(parts: unknown[]): ToolPart[] {
  const out: ToolPart[] = []

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const { type, toolName, input, output } = part as {
      type?: unknown
      toolName?: unknown
      input?: unknown
      output?: unknown
    }

    if (typeof toolName === 'string') out.push({ name: toolName, input, output })
    else if (typeof type === 'string' && type.startsWith('tool-')) {
      out.push({ name: type.slice(5), input, output })
    }
  }

  return out
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}… [truncated]` : value
}

function toolDetail(value: unknown): string {
  if (value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)

  return clip(text, TOOL_DETAIL_MAX_CHARS)
}

function toolLine(part: ToolPart, includeDetails: boolean): string {
  if (!includeDetails) return `[tool: ${part.name}]`
  const input = toolDetail(part.input)
  const output = toolDetail(part.output)

  return [`[tool: ${part.name}]`, input && `  input: ${input}`, output && `  output: ${output}`]
    .filter(Boolean)
    .join('\n')
}

export function compactTranscriptLine(
  message: Pick<AgentMessage, 'index' | 'role' | 'parts' | 'metadata'> & { messageId?: string },
  options: { includeToolDetails?: boolean } = {},
) {
  const tools = messageToolParts(message.parts).map((part) =>
    toolLine(part, options.includeToolDetails ?? false),
  )
  const text = messageTextParts(message.parts).join('\n').trim()
  const body = clip([...tools, text].filter(Boolean).join('\n'), TRANSCRIPT_MESSAGE_MAX_CHARS)

  return `#${String(message.index)} ${message.role}: ${renderAttributedMessage(message.messageId ?? String(message.index), body || '(no text)', message.metadata)}`
}

export async function getConversationTranscriptForAgent(
  viewerUserId: string,
  options: {
    teamId: string | undefined
    sessionId: string
    fromIndex?: number
    limit?: number
    includeToolDetails?: boolean
  },
): Promise<{
  conversation: { sessionId: string; title: string; createdAt: Date; messageCount: number }
  lines: string[]
  nextIndex: number | null
} | null> {
  const conversation = await getReadableConversation(
    options.sessionId,
    viewerUserId,
    options.teamId,
  )

  if (!conversation) return null
  const fromIndex = Math.max(options.fromIndex ?? 0, 0)
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 200)
  const messages = await agentMessages()
    .find(
      {
        sessionId: options.sessionId,
        userId: conversation.userId,
        index: { $gte: fromIndex, $lt: fromIndex + limit + 1 },
      },
      { projection: { index: 1, role: 1, parts: 1, messageId: 1, metadata: 1 } },
    )
    .sort({ index: 1 })
    .toArray()
  const page = messages.slice(0, limit)
  const last = page[page.length - 1]

  return {
    conversation: {
      sessionId: conversation.sessionId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      messageCount: conversation.messageCount,
    },
    lines: page.map((message) =>
      compactTranscriptLine(message, { includeToolDetails: options.includeToolDetails }),
    ),
    nextIndex: messages.length > limit && last ? last.index + 1 : null,
  }
}
