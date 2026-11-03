import { optimisticSenderMetadata } from '../agent/panel/optimisticSender.ts'

import type { AgentPersistedMessage } from '../../api/agent-types'
import type { UserInfo } from '../../types'

/** A post as it shows the moment it is sent, under the id the channel will store it by. */
export function sendingPost(id: string, text: string, user: UserInfo): AgentPersistedMessage {
  const metadata = optimisticSenderMetadata(user, Date.now())

  return { id, role: 'user', parts: [{ type: 'text', text }], ...(metadata ? { metadata } : {}) }
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
