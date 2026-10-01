import { discordProcessedEvents } from '@/lib/discord/store'

import { handleDiscordMention } from './mention'
import { defaultDependencies } from './message-dependencies'

import type { DiscordMessageCreate } from './mention'

export async function recoverDiscordMentions(botUserId: string): Promise<void> {
  const now = new Date()
  const expired = await discordProcessedEvents()
    .find({ status: 'processing', processingExpiresAt: { $lt: now }, payload: { $exists: true } })
    .limit(20)
    .toArray()

  for (const record of expired) {
    const claimed = await defaultDependencies.claimDiscordEvent(record.eventId, record.payload)

    if (claimed) {
      void handleDiscordMention(record.payload as DiscordMessageCreate, botUserId, true)
    }
  }
}
