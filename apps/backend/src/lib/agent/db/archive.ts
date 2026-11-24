import { revokeSessionTokens } from '@/lib/internal-token/revocation'

import { appendArchiveLog, pushArchiveLog } from './archive-log'
import { conversationParticipantIds } from './participants'
import { NOT_A_BOT } from './read-state'
import { agentConversations } from './shared'

import type { ArchiveActor } from './archive-log'
import type { AgentConversation } from './shared'

export type { ArchiveActor } from './archive-log'

const restore = (actor: ArchiveActor, via?: string) => ({
  $unset: { archivedAt: '' as const },
  $set: { archiveRestoredAt: new Date() },
  $inc: { sessionHomeEpoch: 1 },
  $push: pushArchiveLog(false, actor, via),
})

/**
 * Archives a Task and queues its cleanup: the Trigger epoch advances so Triggers
 * created before it are removed, and the current home generation is queued for
 * reclaim on the runtime that holds it.
 */
export const archiveUpdate = (at: Date, actor: ArchiveActor, via?: string) => [
  {
    $set: {
      archivedAt: at,
      archiveLog: appendArchiveLog(true, actor, via),
      archiveTriggersPendingAt: at,
      triggerArchiveEpoch: { $add: [{ $ifNull: ['$triggerArchiveEpoch', 0] }, 1] },
      archiveHomePendingEpochs: {
        $setUnion: [
          { $ifNull: ['$archiveHomePendingEpochs', []] },
          [
            {
              epoch: { $ifNull: ['$sessionHomeEpoch', 0] },
              runtimeId: { $ifNull: ['$runtimeId', null] },
              provider: { $ifNull: ['$agentRuntime', 'claude-code'] },
            },
          ],
        ],
      },
    },
  },
]

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
export const isBotChat = (
  channel: Pick<Archivable, 'kind' | 'group' | 'agentSessionIds' | 'participantIds' | 'userId'>,
) =>
  channel.kind === 'channel' &&
  !channel.group &&
  channel.agentSessionIds?.length === 1 &&
  conversationParticipantIds(channel).length === 1

/** A chat's own name. A Bot's 1:1 chat has none: it is called by its Bot. */
export const chatName = (chat: Parameters<typeof isBotChat>[0] & { title?: string }) =>
  isBotChat(chat) ? '' : (chat.title ?? '')

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
 * `botUnit`). Archiving also archives the owner's threads nested below it, but
 * never a Bot nested there (NOT_A_BOT), stamped with the same `archivedAt`;
 * restoring brings back exactly the descendants carrying that stamp, so a
 * thread archived earlier on its own stays archived. Returns what moved, so a
 * client can follow the server.
 */
export async function setConversationArchived(
  sessionId: string,
  archived: boolean,
  actor: ArchiveActor,
): Promise<ArchiveUnit> {
  const conversation = await agentConversations().findOne({ sessionId }, { projection: ARCHIVABLE })

  if (!conversation) return { sessionIds: [] }
  const unit = await botUnit(conversation, archived)

  for (const id of unit.sessionIds)
    await setTreeArchived(id, archived, actor, id === sessionId ? undefined : sessionId)

  return unit
}

async function setTreeArchived(
  sessionId: string,
  archived: boolean,
  actor: ArchiveActor,
  via?: string,
): Promise<void> {
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
    const cutoff = archivedAt ?? new Date()

    await agentConversations().updateOne(
      { sessionId, archivedAt: { $exists: false } },
      archiveUpdate(cutoff, actor, via),
    )
    await agentConversations().updateMany(
      { sessionId: { $in: descendants }, archivedAt: { $exists: false } },
      archiveUpdate(cutoff, actor, sessionId),
    )
    // A thread never outlives its parent: tokens issued so far stop working.
    await revokeSessionTokens([sessionId, ...descendants], 'archived')
    await withdrawQuestionsAbout(conversation.userId, [sessionId, ...descendants])

    return
  }
  // Only threads the cascade archived come back; one archived on its own stays.
  // Descendants first: the parent's stamp is what a retry needs to find them.
  if (archivedAt && descendants.length > 0) {
    await agentConversations().updateMany(
      { sessionId: { $in: descendants }, archivedAt },
      restore(actor, sessionId),
    )
  }
  await agentConversations().updateOne(
    { sessionId, archivedAt: { $exists: true } },
    restore(actor, via),
  )
}

/**
 * A question only about conversations now archived waits on nothing: it leaves the Inbox.
 * One that is also about something else (a PR) stays for that. However they were archived.
 */
export async function withdrawQuestionsAbout(userId: string, archived: string[]): Promise<void> {
  if (archived.length === 0) return
  await agentConversations().updateMany(
    { userId, 'inputRequests.about': { $in: archived } },
    {
      $pull: {
        inputRequests: {
          about: { $exists: true, $ne: [], $not: { $elemMatch: { $nin: archived } } },
        },
      },
    },
  )
}

/** A shared Task out of one member's lists, or back; it stays as it is for everyone else. */
export async function setMemberArchived(
  sessionId: string,
  userId: string,
  archived: boolean,
): Promise<void> {
  const field = `memberArchivedAt.${userId}`

  await agentConversations().updateOne(
    { sessionId },
    archived ? { $set: { [field]: new Date() } } : { $unset: { [field]: '' } },
  )
}

/**
 * Archive or restore as `userId`, as the app's Archive does: the owner moves the
 * conversation and what moves with it, anyone else in a Task only their own
 * view. Null when they may do neither, as for someone viewing a group chat.
 */
export async function archiveConversationAs(
  conversation: Pick<AgentConversation, 'sessionId' | 'userId' | 'kind' | 'participantIds'>,
  actor: ArchiveActor & { userId: string },
  archived: boolean,
): Promise<ArchiveUnit | null> {
  const { userId } = actor

  if (conversation.userId === userId) {
    return await setConversationArchived(conversation.sessionId, archived, actor)
  }
  if (conversation.kind === 'channel' || !conversation.participantIds?.includes(userId)) return null
  await setMemberArchived(conversation.sessionId, userId, archived)

  return { sessionIds: [conversation.sessionId] }
}

/**
 * Every conversation nested below `rootId` matching `scope`, up to the first Bot
 * on each branch (see NOT_A_BOT); `seen` stops a loop.
 */
export async function descendantSessionIds(
  rootId: string,
  scope: Record<string, unknown>,
): Promise<string[]> {
  const seen = new Set([rootId])
  let frontier = [rootId]

  while (frontier.length > 0) {
    const children = await agentConversations()
      .find(
        { ...scope, ...NOT_A_BOT, parentSessionId: { $in: frontier } },
        { projection: { sessionId: 1 } },
      )
      .toArray()

    frontier = children.map((child) => child.sessionId).filter((id) => !seen.has(id))
    for (const id of frontier) seen.add(id)
  }
  seen.delete(rootId)

  return [...seen]
}

/** Any new human turn brings an archived conversation back, whoever sends it; a Bot with its chats. */
export async function restoreArchivedConversation(
  sessionId: string,
  actor: ArchiveActor,
): Promise<boolean> {
  const result = await agentConversations().updateOne(
    { sessionId, archivedAt: { $exists: true } },
    restore(actor),
  )

  if (result.modifiedCount === 0) return false
  const conversation = await agentConversations().findOne({ sessionId }, { projection: ARCHIVABLE })

  for (const id of conversation ? (await botUnit(conversation)).sessionIds : []) {
    if (id !== sessionId)
      await agentConversations().updateOne(
        { sessionId: id, archivedAt: { $exists: true } },
        restore(actor, sessionId),
      )
  }

  return true
}
