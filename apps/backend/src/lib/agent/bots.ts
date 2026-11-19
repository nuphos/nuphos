import { randomUUID } from 'node:crypto'

import { initializeSessionBypass } from './auto-mode/store'
import { derivedAvatar } from './bot-avatars'
import { botChange, upsertConversationShell } from './db'
import { botStarterInstructions } from './bot-starters'

import type { BotAvatar, BotAvatarBackground } from './bot-avatars'
import type { AgentConversation } from './db'
import type { BotChangeSource } from './db/timeline-events'

export type NewBot = {
  /** What is making it, for the record kept with its face. */
  source: BotChangeSource
  onboarding?: boolean
  starter?: 'coordinate'
  locale?: string
  title?: string
  avatar?: BotAvatar
  background?: BotAvatarBackground
  agentRuntime?: NonNullable<AgentConversation['agentRuntime']>
  runtimeId?: string
  runtimeLabel?: string
}

/**
 * A Bot exists, with the name and face its maker chose, before anyone types:
 * "+" on Bots and the create_bot tool. `userId` owns it, so it is their 1:1 chat.
 * `bypass` is its permission mode: full access when a person chose it, the
 * caller's own mode when an agent made it.
 */
export async function createBot(
  userId: string,
  teamId: string,
  bypass: boolean,
  bot: NewBot,
  sessionId: string = randomUUID(),
) {
  const avatar = bot.avatar ?? derivedAvatar(sessionId)
  const title = bot.title ?? 'New Bot'
  const { source, agentRuntime, runtimeId, runtimeLabel } = bot
  const background = bot.background === 'none' ? undefined : bot.background

  await upsertConversationShell({
    sessionId,
    userId,
    teamId,
    title,
    firstMessage: '',
    bot: {
      avatar,
      ...(background ? { background } : {}),
      change: botChange({ actorId: userId, ...source }, avatar),
    },
    ...(bot.onboarding || bot.starter ? { instructions: botStarterInstructions(bot.starter) } : {}),
    ...(bot.onboarding ? { botOnboarding: 'pending' as const } : {}),
    ...(bot.locale ? { locale: bot.locale } : {}),
    ...(agentRuntime ? { agentRuntime } : {}),
    ...(runtimeId ? { runtimeId, ...(runtimeLabel ? { runtimeLabel } : {}) } : {}),
  })
  await initializeSessionBypass(sessionId, userId, bypass)

  return { sessionId, title, avatar, ...(background ? { avatarBackground: background } : {}) }
}
