import { pruneAvatars } from '@/lib/identity/avatar-upload'

import { isBotChat } from './archive'
import { pushTimelineEvent } from './participants'
import { agentConversations, withTeamScope } from './shared'

import type { BotAvatarBackground } from '../bot-avatars'
import type { BotChangeSource, ConversationTimelineEvent } from './timeline-events'

/** The record of a face given, changed or (null) taken away: who did it and how. */
export function botChange(
  by: { actorId: string } & BotChangeSource,
  avatar: string | null,
): ConversationTimelineEvent {
  return { kind: 'bot_changed', at: new Date(), ...by, ...(avatar === null ? {} : { avatar }) }
}

// Written in the same update as the face, so one cannot exist without the other.
const botChanged = (...change: Parameters<typeof botChange>) =>
  pushTimelineEvent(botChange(...change))

// Refuses to blank a title. The conversation already carries a usable one from
// insert (`fallbackTitle`); overwriting it with '' leaves every reader falling
// back to the raw first message.
export async function updateConversationTitle(
  sessionId: string,
  userId: string,
  title: string,
): Promise<boolean> {
  const next = title.trim()

  if (!next) return false
  const result = await agentConversations().updateOne(
    { sessionId, userId, titleManuallySet: { $ne: true } },
    { $set: { title: next } },
  )

  return result.matchedCount > 0
}

// A manual title wins over an already-running background title generator.
export async function renameConversation(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  title: string,
): Promise<boolean> {
  const next = title.trim()

  if (!next || next.length > 120) return false
  const chat = await agentConversations().findOne(withTeamScope({ sessionId, userId }, teamId))
  // A Bot's chat is called by its Bot, so renaming the chat renames the Bot.
  const target = (chat && isBotChat(chat) && chat.agentSessionIds?.[0]) || sessionId
  const result = await agentConversations().updateOne(
    withTeamScope({ sessionId: target, userId }, teamId),
    { $set: { title: next, titleManuallySet: true } },
  )

  return result.matchedCount > 0
}

// A Bot's new face, and the tint it sits on when given (`none` clears it); null
// takes the face away, so the Bot is a Task again. Only a Bot has a face to
// change: a Task becomes one through claimBotAvatar. Clients own the catalog
// and ignore a name they do not know.
export async function setConversationAvatar(
  sessionId: string,
  avatar: string | null,
  actorId: string,
  background?: BotAvatarBackground,
): Promise<boolean> {
  const $push = botChanged({ actorId, via: 'avatar_route' }, avatar)
  const result = await agentConversations().updateOne(
    avatar === null ? { sessionId } : { sessionId, avatar: { $exists: true } },
    avatar === null
      ? { $unset: { avatar: '', avatarBackground: '' }, $push }
      : background === 'none'
        ? { $set: { avatar }, $unset: { avatarBackground: '' }, $push }
        : { $set: { avatar, ...(background ? { avatarBackground: background } : {}) }, $push },
  )

  return result.matchedCount > 0
}

// "Make this a Bot": the face is set only while there is none, so of two
// requests racing, exactly one wins and the other sees it already done.
export async function claimBotAvatar(
  sessionId: string,
  avatar: string,
  actorId: string,
): Promise<boolean> {
  const result = await agentConversations().updateOne(
    { sessionId, avatar: { $exists: false } },
    // `botGreeting`: its first chat opens with a word from it, not blank (`greetFromTask`).
    {
      $set: { avatar, botGreeting: 'pending' },
      $push: botChanged({ actorId, via: 'make_bot' }, avatar),
    },
  )

  return result.modifiedCount > 0
}

export type BotSelfUpdate = {
  title?: string
  avatar?: string
  instructions?: string
  botOnboarding?: 'completed'
}

// A Bot (a conversation with an avatar) edits its own name, face and
// instructions. A Task has no avatar, so this never turns a Task into a Bot.
export async function updateBotSelf(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  update: BotSelfUpdate,
  via: 'update_self' | 'bot_import' = 'update_self',
): Promise<boolean> {
  if (update.botOnboarding && !update.instructions?.trim()) return false
  const bot = await agentConversations().findOneAndUpdate(
    withTeamScope(
      {
        sessionId,
        userId,
        avatar: { $exists: true },
        ...(update.botOnboarding
          ? {
              botOnboarding: 'active',
              inputRequests: { $not: { $elemMatch: { status: 'open', category: 'preference' } } },
            }
          : {}),
      },
      teamId,
    ),
    {
      $set: {
        ...update,
        ...(update.title === undefined ? {} : { titleManuallySet: true }),
      },
      ...(update.avatar === undefined
        ? {}
        : { $push: botChanged({ actorId: userId, via }, update.avatar) }),
    },
    { projection: { _id: 1 } },
  )

  // A photo the Bot wore until now is no longer its face.
  if (bot && update.avatar !== undefined) await pruneAvatars(bot._id.toHexString())

  return bot !== null
}

// Nests a conversation under another one, or stops nesting it when
// `parentSessionId` is null.
export async function setConversationParent(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  parentSessionId: string | null,
): Promise<'ok' | 'not_found' | 'invalid_parent'> {
  const filter = withTeamScope({ sessionId, userId }, teamId)

  if (parentSessionId === null) {
    const result = await agentConversations().updateOne(filter, {
      $unset: { parentSessionId: '' },
    })

    return result.matchedCount > 0 ? 'ok' : 'not_found'
  }
  const conversation = await agentConversations().findOne(filter, { projection: { teamId: 1 } })

  if (!conversation) return 'not_found'
  if (!(await isValidParent(sessionId, userId, conversation.teamId, parentSessionId))) {
    return 'invalid_parent'
  }
  await agentConversations().updateOne(filter, { $set: { parentSessionId } })

  return 'ok'
}

// The parent must be the same owner's conversation in the same team, and must
// not sit below this one: the sidebars drop every row of a loop.
async function isValidParent(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  parentSessionId: string,
): Promise<boolean> {
  const projection = { sessionId: 1, parentSessionId: 1, teamId: 1 }
  let next = await agentConversations().findOne(
    { sessionId: parentSessionId, userId },
    { projection },
  )

  if (!teamId || next?.teamId !== teamId) return false
  const seen = new Set([sessionId])

  while (next) {
    if (seen.has(next.sessionId)) return false
    seen.add(next.sessionId)
    next = next.parentSessionId
      ? await agentConversations().findOne({ sessionId: next.parentSessionId }, { projection })
      : null
  }

  return true
}

export async function getCompactionSummary(
  sessionId: string,
  userId: string,
): Promise<{ summary: string; messageCount: number } | null> {
  const doc = await agentConversations().findOne(
    { sessionId, userId },
    { projection: { compactionSummary: 1, compactionMessageCount: 1 } },
  )

  if (!doc?.compactionSummary || doc.compactionMessageCount == null) return null

  return { summary: doc.compactionSummary, messageCount: doc.compactionMessageCount }
}

export async function updateCompactionSummary(
  sessionId: string,
  userId: string,
  summary: string,
  messageCount: number,
): Promise<void> {
  await agentConversations().updateOne(
    {
      sessionId,
      userId,
      $or: [
        { compactionMessageCount: { $lt: messageCount } },
        { compactionMessageCount: { $exists: false } },
      ],
    },
    { $set: { compactionSummary: summary, compactionMessageCount: messageCount } },
  )
}
