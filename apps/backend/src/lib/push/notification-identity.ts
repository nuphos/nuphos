import { BOT_AVATAR_BACKGROUNDS, BOT_AVATARS } from '../agent/bot-avatars.ts'
import { isOpenAbProvider } from '../claude-code-preview/runtime-provider.ts'

import type { watcherCanRead } from './watchers'
import type { OpenAbProvider } from '../claude-code-preview/runtime-provider.ts'

export type PushConversation = Parameters<typeof watcherCanRead>[0] & {
  kind?: 'channel'
  avatar?: string
  avatarBackground?: string
  agentRuntime?: string
  title?: string
  firstMessage?: string
  watcherIds?: string[]
}

export type NotificationIdentity = {
  isBot: boolean
  avatar?: string
  background?: string
  provider?: OpenAbProvider
}

/** Canonical Bot identity is a non-channel session with an avatar, as in /:sessionId/bot.
 * A Task carries only its runtime, which iOS draws in place of a face.
 * Runtime must be explicit here; its legacy Claude fallback is not identity evidence. */
export function notificationIdentity(session: {
  kind?: string
  avatar?: string | null
  avatarBackground?: string | null
  agentRuntime?: unknown
}): NotificationIdentity {
  if (session.kind === 'channel') return { isBot: false }

  const provider = isOpenAbProvider(session.agentRuntime) ? { provider: session.agentRuntime } : {}

  if (session.avatar == null) return { isBot: false, ...provider }

  const background = BOT_AVATAR_BACKGROUNDS.find(
    (tint) => tint !== 'none' && tint === session.avatarBackground,
  )

  return {
    isBot: true,
    ...(BOT_AVATARS.some((avatar) => avatar === session.avatar) ? { avatar: session.avatar } : {}),
    ...(background ? { background } : {}),
    ...provider,
  }
}
