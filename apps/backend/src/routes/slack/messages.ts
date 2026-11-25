import { getConversationWithMessages } from '@/lib/agent/db'
import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import type { AgentMessageOrigin } from '@/lib/agent/message-origin'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'
import type { UIMessage } from 'ai'

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
