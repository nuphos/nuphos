import { parseMessageMetadata } from '../agent/panel/messageMetadata'

import type { AgentPersistedMessage } from '../../api'

/** Who posted: the sender's id, so consecutive posts from one sender form a run. */
export function senderOf(message: AgentPersistedMessage): string | undefined {
  const metadata = parseMessageMetadata(message.metadata)

  return metadata ? (metadata.sourceSessionId ?? metadata.sender.id) : undefined
}

export const stamp = (value: string | undefined) => Date.parse(value ?? '') || 0

/** When a post was sent, as the timeline orders it. */
export const postedAt = (message: AgentPersistedMessage) =>
  stamp(parseMessageMetadata(message.metadata)?.sentAt ?? message.createdAt)
