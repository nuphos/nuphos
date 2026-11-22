import { randomUUID } from 'node:crypto'

import { defaultCredentialAccess } from '@/routes/agent/credential-access'

import { initializeSessionBypass } from './auto-mode/store'
import { derivedAvatar } from './bot-avatars'
import { botChange, upsertConversationShell } from './db'
import { botStarterInstructions } from './bot-starters'
import { logError } from '@/lib/observability'

import type { BotAvatar, BotAvatarBackground } from './bot-avatars'
import type { AgentConversation, AgentCredentialAccess } from './db'
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
  /**
   * What a Bot an agent makes may use: its maker's own selection, null when it has none,
   * so it never gets more than its maker. Left out, everything its owner may use.
   */
  credentialAccess?: AgentCredentialAccess | null
}

/**
 * A Bot exists, with the name and face its maker chose, before anyone types:
 * "+" on Bots and the create_bot tool. `userId` owns it, so it is their 1:1 chat.
 * A person's Bot may use everything its owner may use, as a new chat does (#4158);
 * an agent's, what that agent may.
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
  const { source } = bot
  // Stored on its runtime before its first turn, so every list shows the right mark.
  const { agentRuntime, runtimeId, runtimeLabel } = bot.agentRuntime
    ? bot
    : await (
        await import('@/lib/claude-code-preview/conversation-chat-route')
      ).resolveNewConversationRuntime(teamId, userId, bot.runtimeId)
  const background = bot.background === 'none' ? undefined : bot.background
  const credentialAccess =
    bot.credentialAccess === undefined
      ? await defaultCredentialAccess(teamId, userId).catch((err: unknown) => {
          // A Bot that can use nothing yet asks its owner to choose; better than no Bot.
          logError('agent.bot.default_credentials.error', err, { user_id: userId, team_id: teamId })

          return null
        })
      : bot.credentialAccess

  await upsertConversationShell({
    sessionId,
    userId,
    teamId,
    title,
    firstMessage: '',
    ...(credentialAccess ? { credentialAccess } : {}),
    bot: {
      avatar,
      ...(background ? { background } : {}),
      change: botChange({ actorId: userId, ...source }, avatar),
    },
    ...(bot.onboarding || bot.starter ? { instructions: botStarterInstructions(bot.starter) } : {}),
    ...(bot.onboarding ? { botOnboarding: 'pending' as const } : {}),
    ...(bot.locale ? { locale: bot.locale } : {}),
    agentRuntime,
    ...(runtimeId ? { runtimeId, ...(runtimeLabel ? { runtimeLabel } : {}) } : {}),
  })
  await initializeSessionBypass(sessionId, userId, bypass)

  return { sessionId, title, avatar, ...(background ? { avatarBackground: background } : {}) }
}
