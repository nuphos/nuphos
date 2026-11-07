import { optimisticSenderMetadata } from '../agent/panel/optimisticSender.ts'

import type {
  AgentMessageMention,
  AgentMessageReply,
  AgentPersistedMessage,
} from '../../api/agent-types'
import type { UserInfo } from '../../types'

/**
 * A post as it shows the moment it is sent, under the id the channel will store
 * it by, with its files' uploading card if any.
 */
export function sendingPost(
  id: string,
  text: string,
  user: UserInfo,
  upload?: object,
  mentions?: AgentMessageMention[],
  replyTo?: AgentMessageReply,
): AgentPersistedMessage {
  const sender = optimisticSenderMetadata(user, Date.now())
  const metadata = sender && {
    ...sender,
    ...(mentions?.length ? { mentions } : {}),
    ...(replyTo ? { replyTo } : {}),
  }

  return {
    id,
    role: 'user',
    parts: [...(text.trim() ? [{ type: 'text', text }] : []), ...(upload ? [upload] : [])],
    ...(metadata ? { metadata } : {}),
  }
}

/** The posts still on their way: the channel has not returned them yet. */
export function stillSending(
  stored: readonly AgentPersistedMessage[],
  sending: AgentPersistedMessage[],
): AgentPersistedMessage[] {
  const ids = new Set(stored.map((message) => message.id))
  const left = sending.filter((post) => !ids.has(post.id))

  return left.length === sending.length ? sending : left
}
