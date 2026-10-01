import { trustedAvatarURL } from '../../../lib/avatarUrl.ts'

import type { AgentMessageMetadata } from '../../../api/agent-types'
import type { UserInfo } from '../../../types'

// This local preview is replaced by server-authored attribution on turn start.
export function optimisticSenderMetadata(
  user: UserInfo | null | undefined,
  createdAt: number,
): AgentMessageMetadata | undefined {
  if (!user) return undefined
  const avatarURL = trustedAvatarURL(user.avatarURL)

  return {
    version: 1,
    sender: {
      type: 'user',
      id: user.id,
      displayName: user.name || user.username || user.id,
      ...(avatarURL ? { avatarURL } : {}),
    },
    source: 'nuphos',
    sentAt: new Date(createdAt).toISOString(),
  }
}
