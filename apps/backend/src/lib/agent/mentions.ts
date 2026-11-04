import { getTeamMembers } from '@/lib/identity'
import { notifyNudge } from '@/lib/push/notify'

import { agentConversations } from './db/shared'
import { senderLabel } from './message-metadata'

import type { AgentConversation } from './db'
import type { MessageMention, MessageMetadata } from './message-metadata'

/** More than a message can sensibly address; the rest are dropped. */
const MAX_MENTIONS = 20
const PUSH_BODY_CHARS = 180

/** What the composer's chip says for a member, and so what `@…` the text carries. */
export const mentionName = (member: { name?: string; email?: string }) =>
  member.name || member.email || ''

/**
 * The ids the composer claims it mentioned, narrowed to the team's members and
 * named by the server, so the stored metadata never carries a client's names.
 */
export async function resolveMentions(
  teamId: string | undefined,
  claimed: unknown,
  authorId?: string,
): Promise<MessageMention[]> {
  if (!teamId || !Array.isArray(claimed)) return []
  // An id, or a chip as the composer previews it; only the id is taken from it.
  const ids = new Set(
    claimed.flatMap((item: unknown) => {
      const id = typeof item === 'string' ? item : (item as { id?: unknown } | null)?.id

      return typeof id === 'string' && id !== authorId ? [id] : []
    }),
  )

  if (ids.size === 0) return []
  const members = await getTeamMembers(teamId)

  return members
    .filter((member) => ids.has(member.id) && mentionName(member))
    .slice(0, MAX_MENTIONS)
    .map((member) => ({ id: member.id, displayName: mentionName(member) }))
}

/** An agent's post has no chips: who its `@Name` text names among the team. */
async function textMentions(teamId: string, text: string): Promise<string[]> {
  if (!text.includes('@')) return []

  return (await getTeamMembers(teamId)).flatMap((member) => {
    const name = mentionName(member)

    return name && text.includes(`@${name}`) ? [member.id] : []
  })
}

type Mentioning = { id: string; text: string; metadata: MessageMetadata }

/**
 * Who this message @mentions among the conversation's people: each keeps an
 * Inbox entry until they speak there, and gets a push now. Speaking clears the
 * author's own entry.
 */
export async function noteMentions(
  conversation: Pick<AgentConversation, 'sessionId' | 'userId' | 'participantIds' | 'title'> & {
    teamId: string
  },
  message: Mentioning,
): Promise<void> {
  const { sender } = message.metadata
  const author = sender.type === 'user' ? sender.id : undefined
  const people = new Set([conversation.userId, ...(conversation.participantIds ?? [])])
  const claimed =
    message.metadata.mentions?.map((mention) => mention.id) ??
    (await textMentions(conversation.teamId, message.text))
  const mentioned = [...new Set(claimed)].filter((id) => people.has(id) && id !== author)

  if (mentioned.length === 0 && !author) return
  const at = new Date()

  await agentConversations().updateOne(
    { sessionId: conversation.sessionId },
    {
      ...(mentioned.length > 0
        ? {
            $set: Object.fromEntries(
              mentioned.map((id) => [`mentions.${id}`, { messageId: message.id, at }]),
            ),
          }
        : {}),
      ...(author ? { $unset: { [`mentions.${author}`]: '' } } : {}),
    },
  )
  if (mentioned.length === 0) return
  const title = conversation.title || 'Nuphos'

  notifyNudge(mentioned, {
    sessionId: conversation.sessionId,
    teamId: conversation.teamId,
    title: `${senderLabel(sender)} mentioned you in ${title}`,
    body: message.text.slice(0, PUSH_BODY_CHARS),
  })
}
