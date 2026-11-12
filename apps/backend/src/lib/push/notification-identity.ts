import { BOT_AVATARS } from '../agent/bot-avatars.ts'
import { isOpenAbProvider } from '../claude-code-preview/runtime-provider.ts'

import type { watcherCanRead } from './watchers'

export type PushConversation = Parameters<typeof watcherCanRead>[0] & {
  kind?: 'channel'
  avatar?: string
  agentRuntime?: string
  title?: string
  firstMessage?: string
  watcherIds?: string[]
}

/** Canonical Bot identity is a non-channel session with an avatar, as in /:sessionId/bot.
 * Runtime must be explicit here; its legacy Claude fallback is not identity evidence. */
export function notificationIdentity(session: {
  kind?: string
  avatar?: string | null
  agentRuntime?: unknown
}) {
  const isBot = session.kind !== 'channel' && session.avatar != null

  if (!isBot) return { isBot: false } as const

  return {
    isBot: true,
    ...(BOT_AVATARS.some((avatar) => avatar === session.avatar) ? { avatar: session.avatar } : {}),
    ...(isOpenAbProvider(session.agentRuntime) ? { provider: session.agentRuntime } : {}),
  } as const
}
