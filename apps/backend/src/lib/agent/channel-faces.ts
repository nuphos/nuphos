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
 * A chat's members other than the viewer, as iMessage orders them: whoever
 * spoke last first, then the rest in the order they joined.
 */
export async function channelMembers(
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
      agent: { avatar: agent.avatar, provider: agent.provider },
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

  return [...order].flatMap((id) => members.get(id) ?? [])
}

/**
 * What a chat's list row and detail carry for the viewer: the `faces` of its
 * icon and, when no one named it, a `title` of everyone else in it. The name
 * is the viewer's own view, so it is never stored. Other conversations carry neither.
 */
export async function channelFacesField(
  conversation: Parameters<typeof channelMembers>[0] & { kind?: string; title?: string },
  viewerId: string,
  people: Map<string, Person>,
): Promise<{ faces?: ChannelFace[]; title?: string }> {
  if (conversation.kind !== 'channel') return {}
  const members = await channelMembers(conversation, viewerId, people)

  const agents = members.filter((member) => member.agent)
  // A single Bot identifies the chat even after its human collaborators reply.
  const faces =
    agents.length === 1 ? [...agents, ...members.filter((member) => !member.agent)] : members

  return {
    faces: faces.slice(0, FACES),
    ...(conversation.title
      ? {}
      : {
          // Alone in it, the viewer sees their own name rather than none.
          title:
            members.length > 0
              ? members
                  .map((member) => member.name)
                  .sort((a, b) => a.localeCompare(b))
                  .join(', ')
              : (people.get(viewerId)?.name ?? ''),
        }),
  }
}
