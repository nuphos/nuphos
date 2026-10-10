import { db } from '@/lib/db'

import type { DiscordMessageCreate } from './mention'
import type { Collection } from 'mongodb'

export type DiscordSessionScope = {
  sessionId: string
  teamId: string
  guildId: string
  generation: number
}
export type DiscordSessionMessage = DiscordSessionScope & {
  _id: string
  messageId: string
  authorDiscordUserId: string
  authorName: string
  text: string
  recordedAt: Date
}
/** Exactly the fields a session-log query may match on. */
export const discordSessionScope = (thread: DiscordSessionScope): DiscordSessionScope => ({
  sessionId: thread.sessionId,
  teamId: thread.teamId,
  guildId: thread.guildId,
  generation: thread.generation,
})
const messages = () => db().collection<DiscordSessionMessage>('discord_session_messages')

/** An immutable, full-text session log, independent of whether a turn runs. */
export async function recordDiscordSessionMessage(
  scope: DiscordSessionScope,
  event: DiscordMessageCreate,
  authorName: string,
  collection: Pick<Collection<DiscordSessionMessage>, 'updateOne'> = messages(),
): Promise<void> {
  if (!event.author || !event.content?.trim()) return
  const message = {
    sessionId: scope.sessionId,
    teamId: scope.teamId,
    guildId: scope.guildId,
    generation: scope.generation,
    messageId: event.id,
    authorDiscordUserId: event.author.id,
    authorName,
    text: event.content,
  }

  await collection.updateOne(
    { _id: `${scope.sessionId}:${event.id}` },
    { $setOnInsert: { ...message, recordedAt: new Date() } },
    { upsert: true },
  )
}

/**
 * Thread messages the session transcript has not received yet, oldest first.
 * `syncedIds` are the Discord message ids already in the transcript, in order;
 * the first anchors the sync, so a transcript from before ids were tracked
 * receives nothing rather than a replay of its own history.
 */
export async function unsyncedDiscordMessages(
  scope: DiscordSessionScope,
  syncedIds: string[],
  collection: Pick<Collection<DiscordSessionMessage>, 'find' | 'findOne'> = messages(),
): Promise<DiscordSessionMessage[]> {
  const anchor =
    syncedIds[0] && (await collection.findOne({ _id: `${scope.sessionId}:${syncedIds[0]}` }))

  if (!anchor) return []

  // Oldest first, so a backlog longer than one batch is caught up over the
  // following turns instead of losing its start.
  return collection
    .find({
      ...scope,
      messageId: { $nin: syncedIds },
      recordedAt: { $gte: anchor.recordedAt },
    })
    .sort({ recordedAt: 1, messageId: 1 })
    .limit(200)
    .toArray()
}
