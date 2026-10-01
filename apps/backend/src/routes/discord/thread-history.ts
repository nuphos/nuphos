import { clipTranscriptText } from '@/lib/agent/thread-addressing-core'
import { db } from '@/lib/db'

import type { ThreadAddressingMessage } from '@/lib/agent/thread-addressing-core'

export type DiscordThreadHistoryEntry = ThreadAddressingMessage & {
  id: string
  authorDiscordUserId?: string
  recordedAt?: Date
}

type History = { _id: string; messages: DiscordThreadHistoryEntry[] }
const histories = () => db().collection<History>('discord_thread_history')

export async function getDiscordThreadHistory(
  sessionId: string,
): Promise<DiscordThreadHistoryEntry[]> {
  return (await histories().findOne({ _id: sessionId }))?.messages ?? []
}

export async function recordDiscordThreadMessage(
  sessionId: string,
  message: DiscordThreadHistoryEntry,
): Promise<void> {
  await histories().updateOne(
    { _id: sessionId },
    { $setOnInsert: { messages: [] } },
    { upsert: true },
  )
  await histories().updateOne(
    { _id: sessionId, 'messages.id': { $ne: message.id } },
    {
      $push: {
        messages: {
          $each: [{ ...message, text: clipTranscriptText(message.text, message) }],
          $slice: -30,
        },
      },
    },
  )
}
