import { runtimeProvider } from '@/lib/claude-code-preview/runtime-provider'

import { derivedAvatar } from '../bot-avatars'

import { agentConversations } from './shared'

import type { ChannelFields } from './channels'
import type { AgentConversation } from './shared'

/** The channel's agents as their sessions. A deleted session drops out. */
export async function listChannelAgents(channel: ChannelFields & { teamId?: string }) {
  const ids = channel.agentSessionIds ?? []

  if (ids.length === 0) return []
  const sessions = await agentConversations()
    .find({ sessionId: { $in: ids }, teamId: channel.teamId })
    .project<
      Pick<
        AgentConversation,
        'sessionId' | 'userId' | 'title' | 'avatar' | 'avatarBackground' | 'agentRuntime'
      >
    >({
      _id: 0,
      sessionId: 1,
      userId: 1,
      title: 1,
      avatar: 1,
      avatarBackground: 1,
      agentRuntime: 1,
    })
    .toArray()
  const byId = new Map(sessions.map((session) => [session.sessionId, session]))

  return ids.flatMap((id) => {
    const session = byId.get(id)

    return session
      ? [
          {
            sessionId: id,
            title: session.title,
            ownerId: session.userId,
            // A Task has no stored face; in a channel it wears the one its id derives.
            avatar: session.avatar ?? derivedAvatar(id),
            ...(session.avatarBackground ? { avatarBackground: session.avatarBackground } : {}),
            provider: runtimeProvider(session.agentRuntime),
          },
        ]
      : []
  })
}
