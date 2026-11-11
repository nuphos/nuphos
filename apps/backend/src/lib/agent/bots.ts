import { randomUUID } from 'node:crypto'

import { initializeSessionBypass } from './auto-mode/store'
import { derivedAvatar } from './bot-avatars'
import { upsertConversationShell } from './db'

import type { BotAvatar } from './bot-avatars'
import type { AgentConversation } from './db'

export type NewBot = {
  title?: string
  avatar?: BotAvatar
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
  bot: NewBot = {},
  sessionId: string = randomUUID(),
) {
  const avatar = bot.avatar ?? derivedAvatar(sessionId)
  const title = bot.title ?? 'New Bot'
  const { agentRuntime, runtimeId, runtimeLabel } = bot

  await upsertConversationShell({
    sessionId,
    userId,
    teamId,
    title,
    firstMessage: '',
    avatar,
    ...(agentRuntime ? { agentRuntime } : {}),
    ...(runtimeId ? { runtimeId, ...(runtimeLabel ? { runtimeLabel } : {}) } : {}),
  })
  await initializeSessionBypass(sessionId, userId, bypass)

  return { sessionId, title, avatar }
}
