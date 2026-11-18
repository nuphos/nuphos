import { parseMessageMetadata } from '../agent/panel/messageMetadata.ts'
import { textOf } from './channelReply.ts'

import type { AgentPersistedMessage, AgentTimelineEvent } from '../../api'

const stamp = (value: string | undefined) => Date.parse(value ?? '') || 0
const postedAt = (message: AgentPersistedMessage) =>
  stamp(parseMessageMetadata(message.metadata)?.sentAt ?? message.createdAt)
const senderOf = (message: AgentPersistedMessage) => {
  const metadata = parseMessageMetadata(message.metadata)

  return metadata?.sourceSessionId ?? metadata?.sender.id
}

/**
 * Whether a person's post for this agent still waits on it (#3308): any post in its own chat,
 * else one that @mentions it or replies to its post, with neither its post nor its
 * couldn't-reply line after it.
 */
export function awaitsReply(
  agentId: string,
  messages: AgentPersistedMessage[],
  events: (AgentTimelineEvent & { agentId?: string })[],
  ownChat: boolean,
): boolean {
  const forAgent = (message: AgentPersistedMessage) => {
    const metadata = parseMessageMetadata(message.metadata)
    const replied = metadata?.replyTo?.id
      ? messages.find((post) => post.id === metadata.replyTo?.id)
      : undefined

    return (
      metadata?.sender.type === 'user' &&
      (ownChat ||
        textOf(message).includes(`/agent/${agentId}`) ||
        (replied !== undefined && senderOf(replied) === agentId))
    )
  }
  const post = messages.findLast(forAgent)

  if (!post) return false
  const at = postedAt(post)

  return (
    !messages.some((message) => senderOf(message) === agentId && postedAt(message) >= at) &&
    !events.some(
      (event) =>
        event.kind === 'agent_reply_failed' && event.agentId === agentId && stamp(event.at) >= at,
    )
  )
}
