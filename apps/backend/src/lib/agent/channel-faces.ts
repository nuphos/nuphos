import { parseMessageMetadata } from './message-metadata'
import { listChannelAgents } from './db/channels'
import { conversationParticipantIds } from './db/participants'
import { agentMessages } from './db/shared'

import type { AgentConversation } from './db/shared'

/** A member a chat's icon shows: a person, or an agent by its session. */
export type ChannelFace = {
  id: string
  name: string
  avatarURL?: string
  agent?: { avatar?: string; provider?: string }
}

type Person = { id: string; name: string; avatarURL?: string }

const FACES = 2
// Enough recent posts to find who spoke last.
const RECENT_POSTS = 20

/**
 * The chat's icon, as iMessage draws one: up to two members other than the
 * viewer, whoever spoke last first, then the rest in the order they joined.
 */
export async function channelFaces(
  channel: Pick<
    AgentConversation,
    'sessionId' | 'userId' | 'teamId' | 'participantIds' | 'agentSessionIds'
  >,
  viewerId: string,
  people: Map<string, Person>,
): Promise<ChannelFace[]> {
  const [agents, posts] = await Promise.all([
    listChannelAgents(channel),
    agentMessages()
      .find({ sessionId: channel.sessionId, userId: channel.userId })
      .sort({ index: -1 })
      .limit(RECENT_POSTS)
      .project<{ metadata?: unknown }>({ _id: 0, metadata: 1 })
      .toArray(),
  ])
  const members = new Map<string, ChannelFace>()

  for (const agent of agents)
    members.set(agent.sessionId, {
      id: agent.sessionId,
      name: agent.title,
      agent: { ...(agent.avatar ? { avatar: agent.avatar } : {}), provider: agent.provider },
    })
  for (const id of conversationParticipantIds(channel)) {
    const person = people.get(id)

    if (person)
      members.set(id, {
        id,
        name: person.name,
        ...(person.avatarURL ? { avatarURL: person.avatarURL } : {}),
      })
  }
  members.delete(viewerId)
  const spoke = posts.flatMap((post) => parseMessageMetadata(post.metadata)?.sender.id ?? [])
  const order = new Set([...spoke.filter((id) => members.has(id)), ...members.keys()])

  return [...order].slice(0, FACES).flatMap((id) => members.get(id) ?? [])
}

/** The `faces` a chat's list row and detail carry; other conversations carry none. */
export async function channelFacesField(
  conversation: Parameters<typeof channelFaces>[0] & { kind?: string },
  viewerId: string,
  people: Map<string, Person>,
): Promise<{ faces?: ChannelFace[] }> {
  return conversation.kind === 'channel'
    ? { faces: await channelFaces(conversation, viewerId, people) }
    : {}
}
