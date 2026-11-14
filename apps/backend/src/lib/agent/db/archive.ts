import { revokeSessionTokens } from '@/lib/internal-token/revocation'

import { conversationParticipantIds } from './participants'
import { agentConversations } from './shared'

import type { AgentConversation } from './shared'

const restore = () => ({
  $unset: { archivedAt: '' as const },
  $set: { archiveRestoredAt: new Date() },
})

type Archivable = Pick<
  AgentConversation,
  | 'sessionId'
  | 'userId'
  | 'teamId'
  | 'kind'
  | 'group'
  | 'avatar'
  | 'agentSessionIds'
  | 'participantIds'
  | 'archivedAt'
>

const ARCHIVABLE = {
  sessionId: 1,
  userId: 1,
  teamId: 1,
  kind: 1,
  group: 1,
  avatar: 1,
  agentSessionIds: 1,
  participantIds: 1,
  archivedAt: 1,
} as const

/** A Bot's 1:1 chat: a channel whose only other member is one agent, not a group chat. */
export const isBotChat = (channel: Archivable) =>
  channel.kind === 'channel' &&
  !channel.group &&
  channel.agentSessionIds?.length === 1 &&
  conversationParticipantIds(channel).length === 1

/** What one archive or restore moved: the conversation, or a Bot with its chats. */
export type ArchiveUnit = { sessionIds: string[]; botSessionId?: string }

/**
 * A Bot is one thing: its session and its owner's 1:1 chats with it. Archiving
 * or restoring any of them moves all of them, so no chat outlives its Bot.
 */
async function botUnit(conversation: Archivable, archiving = false): Promise<ArchiveUnit> {
  const alone = { sessionIds: [conversation.sessionId] }
  const chatOf = isBotChat(conversation) ? conversation.agentSessionIds?.[0] : undefined
  const botId =
    conversation.kind === 'channel' ? chatOf : conversation.avatar && conversation.sessionId

  if (!botId) return alone
  const scope = { userId: conversation.userId, teamId: conversation.teamId ?? { $exists: false } }
  const [bot, chats] = await Promise.all([
    agentConversations().findOne(
      { ...scope, sessionId: botId, kind: { $exists: false }, avatar: { $exists: true } },
      { projection: { sessionId: 1 } },
    ),
    agentConversations()
      .find({ ...scope, kind: 'channel', agentSessionIds: botId }, { projection: ARCHIVABLE })
      .toArray(),
  ])

  if (!bot) return alone
  // Removing a redundant chat must not archive the agent still used elsewhere.
  if (
    archiving &&
    chatOf &&
    chats.some((chat) => chat.sessionId !== conversation.sessionId && !chat.archivedAt)
  )
    return alone

  return {
    sessionIds: [botId, ...chats.filter(isBotChat).map((chat) => chat.sessionId)],
    botSessionId: botId,
  }
}

/**
 * Who may archive is the route's to check. A Bot goes with its chats (see
 * `botUnit`). Archiving also archives the owner's threads nested below it,
 * stamped with the same `archivedAt`; restoring brings back exactly the
 * descendants carrying that stamp, so a thread archived earlier on its own
 * stays archived. Returns what moved, so a client can follow the server.
 */
export async function setConversationArchived(
  sessionId: string,
  archived: boolean,
): Promise<ArchiveUnit> {
  const conversation = await agentConversations().findOne({ sessionId }, { projection: ARCHIVABLE })

  if (!conversation) return { sessionIds: [] }
  const unit = await botUnit(conversation, archived)

  for (const id of unit.sessionIds) await setTreeArchived(id, archived)

  return unit
}

async function setTreeArchived(sessionId: string, archived: boolean): Promise<void> {
  const conversation = await agentConversations().findOne(
    { sessionId },
    { projection: { sessionId: 1, userId: 1, teamId: 1, archivedAt: 1 } },
  )

  if (!conversation) return
  const { archivedAt } = conversation
  const descendants = await descendantSessionIds(sessionId, {
    userId: conversation.userId,
    teamId: conversation.teamId ?? { $exists: false },
  })

  if (archived) {
    await agentConversations().updateMany(
      { sessionId: { $in: [sessionId, ...descendants] }, archivedAt: { $exists: false } },
      { $set: { archivedAt: archivedAt ?? new Date() } },
    )
    // A thread never outlives its parent: tokens issued so far stop working.
    await revokeSessionTokens([sessionId, ...descendants], 'archived')

    return
  }
  // Only threads the cascade archived come back; one archived on its own stays.
  // Descendants first: the parent's stamp is what a retry needs to find them.
  if (archivedAt && descendants.length > 0) {
    await agentConversations().updateMany(
      { sessionId: { $in: descendants }, archivedAt },
      restore(),
    )
  }
  await agentConversations().updateOne({ sessionId }, restore())
}

/** Every conversation nested below `rootId` matching `scope`; `seen` stops a loop. */
export async function descendantSessionIds(
  rootId: string,
  scope: Record<string, unknown>,
): Promise<string[]> {
  const seen = new Set([rootId])
  let frontier = [rootId]

  while (frontier.length > 0) {
    const children = await agentConversations()
      .find({ ...scope, parentSessionId: { $in: frontier } }, { projection: { sessionId: 1 } })
      .toArray()

    frontier = children.map((child) => child.sessionId).filter((id) => !seen.has(id))
    for (const id of frontier) seen.add(id)
  }
  seen.delete(rootId)

  return [...seen]
}

/** Any new human turn brings an archived conversation back, whoever sends it; a Bot with its chats. */
export async function restoreArchivedConversation(sessionId: string): Promise<boolean> {
  const result = await agentConversations().updateOne(
    { sessionId, archivedAt: { $exists: true } },
    restore(),
  )

  if (result.modifiedCount === 0) return false
  const conversation = await agentConversations().findOne({ sessionId }, { projection: ARCHIVABLE })

  for (const id of conversation ? (await botUnit(conversation)).sessionIds : []) {
    if (id !== sessionId)
      await agentConversations().updateOne(
        { sessionId: id, archivedAt: { $exists: true } },
        restore(),
      )
  }

  return true
}
