import type { AgentMessageOrigin } from '@/lib/agent/message-origin'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { UIMessage } from 'ai'

import { getConversationWithMessages } from '@/lib/agent/db'
import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { parseAgentMessageOrigin } from '@/lib/agent/message-origin'

// Exported for the Slack-bound chat merge (routes/agent/chat-slack-bound.ts),
// which reuses the tool-part expansion but passes unknown parts through
// verbatim instead of dropping them.
export function persistedPartToUiMessagePart(part: unknown): unknown[] {
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

// Exported for the admin rewake endpoint (routes/admin.ts), which rebuilds a
// session's UIMessage history from the stored transcript the same way Slack
// turns do.
export function persistedMessageToUiMessage(message: {
  messageId: string
  role: string
  parts: unknown[]
  metadata?: unknown
  origin?: unknown
  turnKind?: unknown
}): UIMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const parts = message.parts.flatMap(persistedPartToUiMessagePart)

  if (parts.length === 0) return null
  // Carried back onto metadata so a re-sync of this history preserves where
  // each message originally arrived from instead of blanking it.
  const origin = parseAgentMessageOrigin(message.origin)
  const attribution = parseMessageMetadata(message.metadata)

  return {
    id: message.messageId,
    role: message.role,
    parts,
    ...(attribution || origin || message.turnKind === 'plan-approval'
      ? {
          metadata: {
            ...attribution,
            ...(origin ? { origin } : {}),
            ...(message.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' } : {}),
          },
        }
      : {}),
  } as UIMessage
}

// Prior persisted turns + one new user message whose text is already fully
// rendered. Used both for real Slack messages (rendered via
// renderSlackUserMessage) and synthetic turns like a plan approval.
export async function buildMessagesForRenderedTurn(args: {
  sessionId: string
  userId: string
  teamId: string
  messageId: string
  renderedText: string
  actorUserId?: string
  carried?: PendingUserMessage[]
  // Vision parts for images the user attached. They lead the message so the
  // model has looked at the screenshot before it reads the question about it.
  attachmentParts?: unknown[]
  // Which Slack workspace/channel/thread/sender this message arrived from.
  // Stored on the message document; the model reads the same ids from the
  // origin line appended to renderedText.
  origin?: AgentMessageOrigin | null
  turnKind?: 'plan-approval'
}): Promise<UIMessage[]> {
  const attribution = args.actorUserId
    ? await createMessageMetadata(args.actorUserId, 'slack')
    : undefined
  const existing = await getConversationWithMessages(args.sessionId, args.userId, args.teamId)
  const priorMessages = existing?.messages
    .map(persistedMessageToUiMessage)
    .filter((message): message is UIMessage => message !== null)

  return [
    ...(priorMessages ?? []),
    ...(args.carried ?? []).map((entry) => ({
      id: entry.id,
      role: 'user' as const,
      metadata: entry.metadata,
      parts: [{ type: 'text' as const, text: entry.renderedText }],
    })),
    {
      id: args.messageId,
      role: 'user',
      ...(attribution || args.origin || args.turnKind
        ? {
            metadata: {
              ...attribution,
              ...(args.origin ? { origin: args.origin } : {}),
              ...(args.turnKind ? { turnKind: args.turnKind } : {}),
            },
          }
        : {}),
      parts: [
        ...(args.attachmentParts ?? []),
        {
          type: 'text',
          text: args.renderedText,
        },
      ],
    },
  ] as UIMessage[]
}

export function appendAttachmentNote(renderedText: string, note: string): string {
  return note ? `${renderedText}\n\n${note}` : renderedText
}
