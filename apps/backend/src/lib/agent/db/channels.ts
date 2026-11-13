import { runtimeProvider } from '@/lib/claude-code-preview/runtime-provider'
import { AppError } from '@/lib/errors'

import { derivedAvatar } from '../bot-avatars'
import { resolveConversationAccessList } from '../devices/conversation-computer'
import { parseMessageMetadata } from '../message-metadata'
import { fenceUntrusted } from '../untrusted-content'

import { canReply, readableConversationScope } from './access'
import { readNote } from './channel-notes'
import { agentConversations, agentMessages } from './shared'

import type { AgentConversation } from './shared'
import type { MessageMetadata } from '../message-metadata'

/** A channel holds people and Bot sessions; it runs no agent of its own. */
export type ChannelFields = {
  /** Absent is an ordinary agent conversation. */
  kind?: 'channel'
  agentSessionIds?: string[]
  /** An ordinary member selected as the group's lead; never an access grant. */
  leadAgentSessionId?: string
  /** The index of the last channel message each agent has read, by session id. */
  agentReadIndex?: Record<string, number>
  /** Each other member's read marker, by user id, like the owner's `readSeq`. */
  memberReadSeq?: Record<string, number>
  /** Turns agents have woken each other for since the last person spoke. */
  agentTurns?: number
  /** On an agent: the channels it posted in this turn, woken once when the turn ends. */
  channelWakes?: string[]
  /** People @mentioned here, in a channel or a shared agent, who have not posted since: their Inbox entry. */
  mentions?: Record<string, { messageId: string; at: Date }>
  /** A live call mirrored here: speech and chat come in, agents' posts go to its chat. */
  meeting?: { botId: string; botName: string; url: string }
}

/** The sender id a channel notice carries, which also picks its instructions. */
export const CHANNEL_SENDER_PREFIX = 'channel:'

export function isChannel(conversation: ChannelFields | null | undefined): boolean {
  return conversation?.kind === 'channel'
}

/** A channel has no agent of its own, so no turn ever runs in one. */
export function assertNotChannel(conversation: ChannelFields | null | undefined) {
  if (isChannel(conversation))
    throw new AppError(409, 'channel_conversation', 'A channel has no agent of its own to run')
}

/** Adding a session leaves it as it was: a Task stays a Task. */
export async function addChannelAgent(
  channelId: string,
  agentSessionId: string,
): Promise<AgentConversation | null> {
  return agentConversations().findOneAndUpdate(
    { sessionId: channelId, kind: 'channel' },
    { $addToSet: { agentSessionIds: agentSessionId } },
    { returnDocument: 'after' },
  )
}

/** Only a Bot's owner can bring it into a channel of this team. */
export async function ownsChannelAgent(agentSessionId: string, userId: string, teamId: string) {
  const agent = await agentConversations().findOne({ sessionId: agentSessionId })

  if (!agent || agent.teamId !== teamId || isChannel(agent))
    throw new AppError(404, 'not_found', 'Agent conversation not found')

  return agent.userId === userId
}

export async function removeChannelAgent(
  channelId: string,
  agentSessionId: string,
): Promise<AgentConversation | null> {
  return await agentConversations().findOneAndUpdate(
    { sessionId: channelId, kind: 'channel' },
    { $pull: { agentSessionIds: agentSessionId } },
    { returnDocument: 'after' },
  )
}

/** The channel's agents as their sessions. A deleted session drops out. */
export async function listChannelAgents(channel: ChannelFields & { teamId?: string }) {
  const ids = channel.agentSessionIds ?? []

  if (ids.length === 0) return []
  const sessions = await agentConversations()
    .find({ sessionId: { $in: ids }, teamId: channel.teamId })
    .project<Pick<AgentConversation, 'sessionId' | 'userId' | 'title' | 'avatar' | 'agentRuntime'>>(
      { _id: 0, sessionId: 1, userId: 1, title: 1, avatar: 1, agentRuntime: 1 },
    )
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
            provider: runtimeProvider(session.agentRuntime),
          },
        ]
      : []
  })
}

/** A stored chat post's words. */
export function postText(parts: readonly unknown[] | undefined): string {
  return (parts ?? [])
    .flatMap((part) => {
      const { type, text } = part as { type?: unknown; text?: unknown }

      return type === 'text' && typeof text === 'string' ? [text] : []
    })
    .join('\n')
}

/** The upload groups a stored chat post carries. */
function channelUploadIds(parts: readonly unknown[] | undefined): string[] {
  return (parts ?? []).flatMap((part) => {
    const { type, groupId } = part as { type?: unknown; groupId?: unknown }

    return (type === 'transfer-upload' || type === 'transfer-download') &&
      typeof groupId === 'string'
      ? [groupId]
      : []
  })
}

// A turn's worth of reading. An agent new to the channel starts at its latest page.
const READ_PAGE = 50

/** Moves the agent's place in a channel forward to `index`. */
export async function markChannelRead(channelId: string, agentSessionId: string, index: number) {
  await agentConversations().updateOne(
    { sessionId: channelId },
    // Two reads at once must not move the place back.
    { $max: { [`agentReadIndex.${agentSessionId}`]: index } },
  )
}

/**
 * Whether the reading agent's owner posted this, as themselves in the app. Only
 * the server-authored sender id counts: never a display name or quoted text.
 */
function fromOwner(metadata: MessageMetadata | undefined, ownerId: string) {
  return (
    metadata?.source === 'nuphos' &&
    metadata.sender.type === 'user' &&
    !metadata.sender.onBehalfOf &&
    metadata.sender.id === ownerId
  )
}

/**
 * What the agent has not read yet, oldest first, and moves its cursor past it.
 * `peek` leaves the cursor for the caller to move to `upTo` once the posts are
 * delivered; `upTo` stops before the first message with files, so channel_read
 * still places them on the agent's runtime.
 */
export async function readChannelMessages(
  channel: Pick<
    AgentConversation,
    | 'sessionId'
    | 'userId'
    | 'messageCount'
    | 'agentReadIndex'
    | 'agentSessionIds'
    | 'instructions'
    | 'leadAgentSessionId'
  >,
  agentSessionId: string,
  /** The reading agent's owner, whose posts carry `fromOwner`. */
  ownerId: string,
  peek = false,
) {
  const after = channel.agentReadIndex?.[agentSessionId] ?? channel.messageCount - READ_PAGE - 1
  const docs = await agentMessages()
    .find({ sessionId: channel.sessionId, userId: channel.userId, index: { $gt: after } })
    .sort({ index: 1 })
    .limit(READ_PAGE + 1)
    .toArray()
  const page = docs.slice(0, READ_PAGE)
  const held = peek ? page.findIndex((doc) => channelUploadIds(doc.parts).length > 0) : -1
  const last = held < 0 ? page.at(-1) : page[held - 1]

  if (last && !peek) await markChannelRead(channel.sessionId, agentSessionId, last.index)

  return {
    messages: page.map((doc) => {
      const metadata = parseMessageMetadata(doc.metadata)
      const uploads = channelUploadIds(doc.parts)

      return {
        index: doc.index,
        sender: metadata
          ? {
              type: metadata.sender.type,
              id: metadata.sender.id,
              name: metadata.sender.displayName,
              ...(fromOwner(metadata, ownerId) ? { fromOwner: true } : {}),
            }
          : null,
        sentAt: metadata?.sentAt ?? null,
        // Members' words, fenced so nothing in them can pose as an instruction.
        text: fenceUntrusted('channel-message', postText(doc.parts), '').trimEnd(),
        // The earlier post it answers, fenced the same way.
        ...(metadata?.replyTo
          ? {
              replyTo: fenceUntrusted(
                'channel-message',
                `${metadata.replyTo.authorName}: ${metadata.replyTo.text}`,
                '',
              ).trimEnd(),
            }
          : {}),
        // Files posted with it, placed on the reader's runtime by channel_read.
        ...(uploads.length > 0 ? { uploads } : {}),
      }
    }),
    upTo: last?.index,
    more: docs.length > READ_PAGE,
    ...(channel.instructions
      ? { sharedInstructions: fenceUntrusted('channel-setup', channel.instructions, '') }
      : {}),
    ...(channel.leadAgentSessionId && channel.agentSessionIds?.includes(channel.leadAgentSessionId)
      ? { leadAgentSessionId: channel.leadAgentSessionId }
      : {}),
    note: readNote(channel),
  }
}

/**
 * Where the viewer was @mentioned and has not posted since, the newest first.
 * Not where they cannot reply now: they could never post to clear it.
 */
export async function listChannelMentions(teamId: string, viewerId: string) {
  const mentioning = await agentConversations()
    .find(
      readableConversationScope({ [`mentions.${viewerId}`]: { $exists: true } }, viewerId, teamId),
    )
    .toArray()
  const access = await resolveConversationAccessList(mentioning, viewerId)
  const channels = mentioning.filter((_, index) => canReply(access[index] ?? null))
  const found = await Promise.all(
    channels.map(async (channel) => {
      const mention = channel.mentions?.[viewerId]
      const message =
        mention &&
        (await agentMessages().findOne({
          sessionId: channel.sessionId,
          userId: channel.userId,
          messageId: mention.messageId,
        }))

      if (!mention || !message) return []
      const metadata = parseMessageMetadata(message.metadata)

      return [
        {
          channelId: channel.sessionId,
          kind: isChannel(channel) ? 'channel' : 'agent',
          title: channel.title,
          messageId: mention.messageId,
          at: mention.at.toISOString(),
          sender: metadata
            ? {
                type: metadata.sender.type,
                id: metadata.sender.id,
                name: metadata.sender.displayName,
              }
            : null,
          text: postText(message.parts),
        },
      ]
    }),
  )

  return found.flat().sort((a, b) => b.at.localeCompare(a.at))
}
