import { renderAttributedMessage } from '../message-metadata'
import { steeringHistoryText } from '../steering-history'

import { getReadableConversation } from './conversations'
import { agentMessages } from './shared'
import { transcriptTurnDiagnostics } from './transcript-diagnostics'

import type { AgentMessage } from './shared'
import type { LiveTurn } from '../live-turn'

const TRANSCRIPT_MESSAGE_MAX_CHARS = 4_000

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

function historyPart(part: unknown, includeDetails: boolean): string {
  if (!part || typeof part !== 'object') return ''
  const value = part as Record<string, unknown>

  if (value.type === 'text' && typeof value.text === 'string') return value.text.trim()
  if (value.type === 'data-steering') return steeringHistoryText(value.data) ?? ''
  const tool = messageToolParts([part])[0]

  return tool ? toolLine(tool, includeDetails) : ''
}

export function compactTranscriptLine(
  message: Pick<AgentMessage, 'index' | 'role' | 'parts' | 'metadata'> & { messageId?: string },
  options: { includeToolDetails?: boolean } = {},
) {
  const body = clip(
    message.parts
      .map((part) => historyPart(part, options.includeToolDetails ?? false))
      .filter(Boolean)
      .join('\n'),
    TRANSCRIPT_MESSAGE_MAX_CHARS,
  )

  return `#${String(message.index)} ${message.role}: ${renderAttributedMessage(message.messageId ?? String(message.index), body || '(no text)', message.metadata)}`
}

/** The running turn as the transcript's next line, in arrival order. Clipped
 *  from the front: the latest narration is what a reader needs. */
export function liveTurnTranscriptLine(
  index: number,
  turn: LiveTurn,
  options: { includeToolDetails?: boolean } = {},
) {
  const body = turn.parts
    .map((part) => {
      if (part.type === 'tool') return toolLine(part, options.includeToolDetails ?? false)

      return part.text.trim()
    })
    .filter(Boolean)
    .join('\n')
  const clipped =
    body.length > TRANSCRIPT_MESSAGE_MAX_CHARS
      ? `[earlier output truncated] …${body.slice(-TRANSCRIPT_MESSAGE_MAX_CHARS)}`
      : body

  return `#${String(index)} assistant (in progress, started ${turn.startedAt ?? 'unknown'}, last update ${turn.updatedAt ?? 'unknown'}): ${clipped || '(no output yet)'}`
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
  conversation: {
    sessionId: string
    userId: string
    title: string
    createdAt: Date
    messageCount: number
  }
  lines: string[]
  turnDiagnostics: ReturnType<typeof transcriptTurnDiagnostics>
  nextIndex: number | null
  /** When the page's last message was first stored, if it is an assistant's. */
  lastAssistantAt: Date | null
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
      { projection: { index: 1, role: 1, parts: 1, messageId: 1, metadata: 1, createdAt: 1 } },
    )
    .sort({ index: 1 })
    .toArray()
  const page = messages.slice(0, limit)
  const last = page[page.length - 1]

  return {
    conversation: {
      sessionId: conversation.sessionId,
      userId: conversation.userId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      messageCount: conversation.messageCount,
    },
    lines: page.map((message) =>
      compactTranscriptLine(message, { includeToolDetails: options.includeToolDetails }),
    ),
    turnDiagnostics: page.flatMap(transcriptTurnDiagnostics),
    nextIndex: messages.length > limit && last ? last.index + 1 : null,
    lastAssistantAt: last?.role === 'assistant' ? last.createdAt : null,
  }
}
