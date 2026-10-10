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

const laterThan = (a: string, b: string) => (a.length === b.length ? a > b : a.length > b.length)

/**
 * Thread messages the session transcript has not received yet, oldest first.
 * `syncedIds` are the Discord message ids already in the transcript, in order;
 * the first anchors the sync, so a transcript from before ids were tracked
 * receives nothing rather than a replay of its own history.
 */
export async function unsyncedDiscordMessages(
  scope: DiscordSessionScope,
  currentMessageId: string,
  syncedIds: string[],
  collection: Pick<Collection<DiscordSessionMessage>, 'find'> = messages(),
): Promise<DiscordSessionMessage[]> {
  const anchor = syncedIds[0]

  if (!anchor) return []
  const synced = new Set(syncedIds)
  // Full text remains durable for the entire session. Limit the catch-up
  // window, not storage.
  const recent = await collection
    .find({ ...scope, messageId: { $ne: currentMessageId } })
    .sort({ recordedAt: -1, messageId: -1 })
    .limit(50)
    .toArray()

  return recent
    .toReversed()
    .filter((message) => !synced.has(message.messageId) && laterThan(message.messageId, anchor))
}
