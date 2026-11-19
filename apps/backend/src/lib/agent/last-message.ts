import { plainText } from '@/lib/push/turn-outcome'

import { agentMessages } from './db/shared'
import { parseMessageMetadata } from './message-metadata'
import { withCurrentAgentNames } from './sender-names'

import type { AgentConversation } from './db/shared'

/**
 * A chat's newest message, for its list row's preview. `text` is plain text,
 * as a notification shows it, so no client renders markdown syntax; it is
 * empty when the message only carries files.
 * `from` names who sent it in a group chat, unless it was the viewer.
 */
export type LastMessage = { text: string; from?: string }

const PREVIEW_CHARS = 300
const FILE_PARTS = new Set(['file', 'transfer-upload', 'transfer-download'])

type Part = { type?: unknown; text?: unknown }

export async function lastMessage(
  conversation: Pick<AgentConversation, 'sessionId' | 'userId' | 'teamId'> & { kind?: string },
  viewerId: string,
): Promise<LastMessage | undefined> {
  const [message] = await agentMessages()
    // Skip a turn's tool-only messages, so the preview holds while an agent works.
    .find({
      sessionId: conversation.sessionId,
      userId: conversation.userId,
      'parts.type': { $in: ['text', ...FILE_PARTS] },
      // A system wake-up (a channel's new messages) is not something anyone said.
      'metadata.sender.type': { $ne: 'system' },
    })
    .sort({ index: -1 })
    .limit(1)
    // Only short text and file markers leave the database: a turn's tool output can be large.
    .project<{ parts?: Part[]; metadata?: unknown }>({
      _id: 0,
      metadata: 1,
      parts: {
        $map: {
          input: {
            $filter: {
              input: '$parts',
              cond: { $in: ['$$this.type', ['text', ...FILE_PARTS]] },
            },
          },
          in: {
            type: '$$this.type',
            text: { $substrCP: [{ $ifNull: ['$$this.text', ''] }, 0, PREVIEW_CHARS] },
          },
        },
      },
    })
    .toArray()

  if (!message) return undefined
  const parts = message.parts ?? []
  // An agent's reply ends with its answer, so the last text says the most.
  const text = parts
    .flatMap((part) =>
      part.type === 'text' && typeof part.text === 'string' && part.text.trim() ? [part.text] : [],
    )
    .at(-1)
  const files = parts.some((part) => FILE_PARTS.has(part.type as string))

  if (!text && !files) return undefined
  const metadata = parseMessageMetadata(message.metadata)
  // Only a group chat's row names its sender, so only it looks the name up.
  const sender =
    conversation.kind === 'channel' && metadata && metadata.sender.id !== viewerId
      ? (await withCurrentAgentNames([{ metadata }], conversation.teamId))[0]?.metadata.sender
      : undefined
  const from = sender && shortName(sender.type, sender.displayName)

  return { text: plainText(text?.slice(0, PREVIEW_CHARS) ?? ''), ...(from ? { from } : {}) }
}

/** A person by their first name, as iMessage does; an agent's title is its only name. */
function shortName(type: string, displayName: string): string {
  return type === 'user' ? (displayName.trim().split(/\s+/)[0] ?? displayName) : displayName
}
