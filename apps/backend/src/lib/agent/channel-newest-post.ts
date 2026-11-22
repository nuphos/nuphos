import { postText } from './db/channels'
import { agentMessages } from './db/shared'
import { parseMessageMetadata } from './message-metadata'

import type { AgentConversation } from './db/shared'
import type { ChannelPostPreview } from './message-metadata'

/** A stored chat post's first file name, for a post that is only files. */
function firstFileName(parts: readonly unknown[] | undefined): string {
  for (const part of parts ?? []) {
    const { type, files } = part as { type?: unknown; files?: { fileName?: unknown }[] }
    const name = type === 'transfer-upload' && Array.isArray(files) ? files[0]?.fileName : undefined

    if (typeof name === 'string' && name) return name
  }

  return ''
}

/** A post's first line as plain text: markdown marks dropped, a code block's first line. */
export function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('```'))

  return (line ?? '')
    .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '')
    .replace(/\]\([^)]*\)/g, '')
    .replace(/!?\[|\]/g, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .trim()
    .slice(0, 200)
}

/**
 * The newest post of a page an agent was shown, as people see it on the agent's
 * page: who posted it, its first line (or its file's name; empty for an agent's
 * files), and how many other posts came with it.
 */
export async function newestPost(
  channel: Pick<AgentConversation, 'sessionId' | 'userId'>,
  page: { messages: { index: number }[] },
): Promise<ChannelPostPreview | undefined> {
  const last = page.messages.at(-1)
  const doc =
    last &&
    (await agentMessages().findOne({
      sessionId: channel.sessionId,
      userId: channel.userId,
      index: last.index,
    }))
  const metadata = doc ? parseMessageMetadata(doc.metadata) : undefined

  if (!doc || !metadata) return undefined
  const { type, id, displayName, avatarURL, agentRuntime } = metadata.sender

  return {
    id: doc.messageId,
    sender: {
      type,
      // An agent is known by its conversation, as its avatar is.
      id: metadata.sourceSessionId ?? id,
      displayName,
      ...(avatarURL ? { avatarURL } : {}),
      ...(agentRuntime ? { agentRuntime } : {}),
    },
    text: firstLine(postText(doc.parts)) || firstFileName(doc.parts),
    more: page.messages.length - 1,
  }
}
