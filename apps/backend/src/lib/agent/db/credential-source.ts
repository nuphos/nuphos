import { agentConversations, withTeamScope } from './shared'

import type { AgentConversation } from './shared'

type Link = Pick<AgentConversation, 'sessionId' | 'userId' | 'teamId' | 'parentSessionId'>
export type CredentialSource = Link & Pick<AgentConversation, 'credentialAccess' | 'metadata'>

const projection = {
  sessionId: 1,
  userId: 1,
  teamId: 1,
  parentSessionId: 1,
  credentialAccess: 1,
  'metadata.source': 1,
}

/**
 * The conversation whose credentials and computers `conversation` uses: a Task
 * under a Bot uses its topmost ancestor's selection and has none of its own.
 * Only the same owner's ancestors count, so a parent that is gone or someone
 * else's ends the chain there.
 */
export async function credentialSource<T extends Link>(
  conversation: T,
): Promise<T | CredentialSource> {
  const seen = new Set([conversation.sessionId])
  let source: T | CredentialSource = conversation

  while (source.parentSessionId && !seen.has(source.parentSessionId)) {
    const parent: CredentialSource | null = await agentConversations().findOne(
      {
        ...withTeamScope(
          { sessionId: source.parentSessionId, userId: source.userId },
          source.teamId,
        ),
        kind: { $ne: 'channel' },
      },
      { projection },
    )

    if (!parent) break
    seen.add(parent.sessionId)
    source = parent
  }

  return source
}

/** As `credentialSource`, from a session id; null when there is no such conversation. */
export async function credentialSourceOf(sessionId: string): Promise<CredentialSource | null> {
  const conversation = await agentConversations().findOne({ sessionId }, { projection })

  return conversation && credentialSource(conversation)
}

/** Every conversation that uses `source`'s selection: itself and the Tasks below it. */
export async function credentialHeirs(source: Link): Promise<string[]> {
  const heirs = [source.sessionId]

  for (let level = [source.sessionId]; level.length;) {
    const below = await agentConversations()
      .find(
        {
          ...withTeamScope({ userId: source.userId }, source.teamId),
          parentSessionId: { $in: level },
          sessionId: { $nin: heirs },
        },
        { projection: { sessionId: 1 } },
      )
      .toArray()

    level = below.map((conversation) => conversation.sessionId)
    heirs.push(...level)
  }

  return heirs
}
