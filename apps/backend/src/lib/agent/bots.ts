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
 */
export async function createBot(userId: string, teamId: string, bot: NewBot = {}) {
  const sessionId = randomUUID()
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
  // A Bot works on its own, so it starts in full access, as a new chat would set it.
  await initializeSessionBypass(sessionId, userId, true)

  return { sessionId, title, avatar }
}
