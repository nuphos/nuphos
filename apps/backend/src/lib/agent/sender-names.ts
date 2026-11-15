import { agentConversations } from './db/shared'

import type { MessageMetadata } from './message-metadata'

/**
 * An agent's message stores the name it posted under; readers see the name it
 * has now, so a renamed Bot is one name everywhere. The stored one stays only
 * for an agent that no longer exists.
 */
export async function withCurrentAgentNames<T extends { metadata?: MessageMetadata }>(
  messages: T[],
  teamId: string | undefined,
): Promise<T[]> {
  const agentId = (message: T) =>
    message.metadata?.sender.type === 'agent' ? message.metadata.sender.id : undefined
  const ids = [...new Set(messages.flatMap((message) => agentId(message) ?? []))]

  if (ids.length === 0) return messages
  const agents = await agentConversations()
    .find({ sessionId: { $in: ids }, ...(teamId ? { teamId } : {}) })
    .project<{ sessionId: string; title?: string }>({ _id: 0, sessionId: 1, title: 1 })
    .toArray()
  const names = new Map(
    agents.flatMap((agent) => (agent.title ? [[agent.sessionId, agent.title]] : [])),
  )

  return messages.map((message) => {
    const id = agentId(message)
    const name = id && names.get(id)

    return name && message.metadata
      ? {
          ...message,
          metadata: {
            ...message.metadata,
            sender: { ...message.metadata.sender, displayName: name },
          },
        }
      : message
  })
}
